import { VybeWebSocketFilters, VybeTransferFilter, VybeTradeFilter, VybeOraclePriceFilter } from './services/vybeWebSocket';
import { getAllTrackedWalletsWithState } from './database';
// import { getAllTrackedWalletsWithState, getMintAddressesWithActiveAlerts } from './database'; // Assuming this function exists and works with the proxy
// import { /* other DB functions like getTokensFromAlerts */ } from './database';

/**
 * Generates the complete set of WebSocket filters based on the current database state.
 * @param db - The database connection or proxy.
 * @returns A promise resolving to the VybeWebSocketFilters object.
 */
export async function generateCurrentFilters(db: any): Promise<VybeWebSocketFilters> {
    console.log('[FilterService] Generating current WebSocket filters...');

    try {
        // --- Transfer Filters --- 
        const allWalletsState: Array<{ wallet_address: string, [key: string]: any }> = await getAllTrackedWalletsWithState(db);
        const uniqueWallets = [...new Set(allWalletsState.map((w: { wallet_address: string }) => w.wallet_address))];

        const transferFilters: VybeTransferFilter[] = uniqueWallets.flatMap(address => [
            { senderAddress: address },
            { receiverAddress: address }
        ]);
        console.log(`[FilterService] Generated ${transferFilters.length} transfer filters for ${uniqueWallets.length} unique wallets.`);

        // --- Trade Filters (Optional - Placeholder) ---
        // TODO: Implement logic if trade tracking is desired (e.g., fetch KOLs)
        const tradeFilters: VybeTradeFilter[] = []; // Default to empty with correct type
        console.log(`[FilterService] Trade filters are currently not implemented.`);

        // --- Oracle Price Filters (Reverted - Placeholder) ---
        // const priceAlertMints = await getMintAddressesWithActiveAlerts(db);
        // let oraclePriceFilters: VybeOraclePriceFilter[] = [];
        // if (priceAlertMints.length > 0) { ... }
        const oraclePriceFilters: VybeOraclePriceFilter[] = []; // Default to empty
        console.log(`[FilterService] Oracle price filters are currently not implemented.`);


        const filters: Partial<VybeWebSocketFilters> = {
            transfers: transferFilters.length > 0 ? transferFilters : undefined,
            trades: tradeFilters.length > 0 ? tradeFilters : undefined,
            oraclePrices: oraclePriceFilters.length > 0 ? oraclePriceFilters : undefined, // Keep placeholder or set undefined
        };

        // Remove undefined keys
        Object.keys(filters).forEach(key => {
            const filterKey = key as keyof VybeWebSocketFilters;
            if (filters[filterKey] === undefined) {
                delete filters[filterKey];
            }
        });

        console.log('[FilterService] Generated filters:', JSON.stringify(filters));
        return filters as VybeWebSocketFilters;

    } catch (error) {
        console.error("[FilterService] Error generating filters:", error);
        // Return empty filters or re-throw based on desired error handling
        return {};
    }
} 