import { getActiveKOLAccounts, KnownAccount } from './vybeApi';
import { getPreviousTopKols, updatePreviousTopKols } from './database';
import { broadcastKOLUpdates, KOLChangeData } from './telegram'; // Assuming broadcastKOLUpdates and KOLChangeData are exported from telegram.ts
import { bot } from './telegram'; // Import bot for potential direct use later if needed

const KOL_CHECK_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour
const TOP_N_KOLS = 10; // How many KOLs to track for changes
const TOP_N_FOR_NEW_ENTRANTS = 5; // Check for new entrants within this top N

let isCheckingKols = false; // Prevent concurrent runs

/**
 * Checks for changes in the Top N KOL rankings and triggers broadcasts.
 */
async function checkKOLRankingChanges(db: any) {
    if (isCheckingKols) {
        console.log('[KOL Ranking] Check already in progress, skipping this interval.');
        return;
    }
    isCheckingKols = true;
    console.log('[KOL Ranking] Starting check...');

    try {
        // 1. Fetch Current Ranking
        const currentActiveKols = await getActiveKOLAccounts();
        if (!currentActiveKols || currentActiveKols.length === 0) {
            console.warn('[KOL Ranking] No active KOLs found currently.');
            isCheckingKols = false;
            return;
        }

        // Sort by volume (descending) and take Top N
        const currentTopKols = currentActiveKols
            .sort((a, b) => b.pnlData.summary.tradesVolumeUsd - a.pnlData.summary.tradesVolumeUsd)
            .slice(0, TOP_N_KOLS);

        // 2. Fetch Previous Ranking
        const previousTopKols = await getPreviousTopKols(db);

        // 3. Handle Initial Run or No Previous Data
        if (previousTopKols.length === 0) {
            console.log('[KOL Ranking] No previous ranking found. Storing current ranking.');
            await updatePreviousTopKols(db, currentTopKols);
            isCheckingKols = false;
            return;
        }

        // 4. Compare Rankings & 5. Detect Significant Changes
        const changeData: KOLChangeData = {};
        let significantChangeDetected = false;

        // Check #1 change
        const currentTop1 = currentTopKols.length > 0 ? currentTopKols[0] : null;
        const previousTop1 = previousTopKols.length > 0 ? previousTopKols[0] : null;
        if (currentTop1 && previousTop1 && currentTop1.ownerAddress !== previousTop1.owner_address) {
            console.log(`[KOL Ranking] New #1 detected: ${currentTop1.name} (${currentTop1.ownerAddress})`);
            changeData.newNumberOne = { name: currentTop1.name, address: currentTop1.ownerAddress };
            significantChangeDetected = true;
        }

        // Check for new entrants in Top N (e.g., Top 5)
        const currentTopNSet = new Set(currentTopKols.slice(0, TOP_N_FOR_NEW_ENTRANTS).map(k => k.ownerAddress));
        const previousTopNSet = new Set(previousTopKols.slice(0, TOP_N_FOR_NEW_ENTRANTS).map(k => k.owner_address));
        const newEntrants = currentTopKols
            .slice(0, TOP_N_FOR_NEW_ENTRANTS)
            .filter(k => !previousTopNSet.has(k.ownerAddress));

        if (newEntrants.length > 0) {
            console.log(`[KOL Ranking] New entrants in Top ${TOP_N_FOR_NEW_ENTRANTS}:`, newEntrants.map(k => k.name));
            changeData.newEntrantsTop5 = newEntrants.map(k => ({ name: k.name, address: k.ownerAddress }));
            significantChangeDetected = true;
        }

        // 7. Update Database State (Always update to prevent repeated alerts for the same change)
        await updatePreviousTopKols(db, currentTopKols);

        // 8. Trigger Broadcast if changes were detected
        if (significantChangeDetected) {
            console.log('[KOL Ranking] Significant changes detected. Triggering broadcast...');
            // Call the broadcast function (ensure it's exported from telegram.ts)
            await broadcastKOLUpdates(db, changeData);
        } else {
            console.log('[KOL Ranking] No significant changes detected.');
        }

    } catch (error) {
        console.error('[KOL Ranking] Error during check:', error);
    } finally {
        isCheckingKols = false;
        console.log('[KOL Ranking] Check finished.');
    }
}

/**
 * Starts the periodic check for KOL ranking changes.
 */
export function startKolRankingService(db: any) {
    console.log(`[KOL Ranking] Service starting. Checking every ${KOL_CHECK_INTERVAL_MS / 1000 / 60} minutes.`);

    // Initial check shortly after start, then regular interval
    setTimeout(() => checkKOLRankingChanges(db).catch(console.error), 5000); // Check 5 seconds after start

    setInterval(() => {
        checkKOLRankingChanges(db).catch(error => {
            console.error('[KOL Ranking] Error in scheduled check:', error);
        });
    }, KOL_CHECK_INTERVAL_MS);
} 