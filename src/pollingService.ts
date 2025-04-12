import cron from 'node-cron';
import { bot } from './telegram';
import { getAllTrackedWalletsWithState, updateLastNotifiedSignature } from './database';
import { getRecentTransfersForWallet, VybeTransfer } from './vybeApi';
import { walletLog, logTransferNotification } from './logger';

// Function to format a transfer for display
function formatTransfer(transfer: VybeTransfer): string {
    const time = new Date(transfer.blockTime * 1000).toLocaleString();
    const symbol = typeof transfer.tokenDetails === 'string'
        ? transfer.tokenDetails
        : transfer.tokenDetails.symbol;
    return `- ${time}: ${transfer.amount} ${symbol} from \`${transfer.senderAddress}\` to \`${transfer.receiverAddress}\`\n  [View on Solscan](https://solscan.io/tx/${transfer.signature})`;
}

// Function to check for new transfers for a specific wallet
async function checkSingleWalletActivity(db: any, walletAddress: string, users: Array<{
    userId: number,
    lastSig: string | null,
    lastBlockTime: number | null,
    trackingStartedAt: number | null,
    createdAt: string
}>) {
    try {
        walletLog(walletAddress, null, `Checking for new transfers`, { userCount: users.length });

        const transfers = await getRecentTransfersForWallet(walletAddress);
        if (!transfers || transfers.length === 0) {
            walletLog(walletAddress, null, `No transfers found`);
            return;
        }

        walletLog(walletAddress, null, `Found ${transfers.length} transfers`, {
            newest: {
                signature: transfers[0].signature,
                blockTime: transfers[0].blockTime,
                time: new Date(transfers[0].blockTime * 1000).toISOString()
            },
            oldest: {
                signature: transfers[transfers.length - 1].signature,
                blockTime: transfers[transfers.length - 1].blockTime,
                time: new Date(transfers[transfers.length - 1].blockTime * 1000).toISOString()
            }
        });

        // Create a map to store new transfers per user
        const userNotifications = new Map<number, VybeTransfer[]>();
        // Track skipped transfers and reasons for debugging
        const skippedTransfers = new Map<number, Array<VybeTransfer & { reason: string }>>();

        // Process transfers from newest to oldest
        for (const transfer of transfers) {
            // Check which users tracking this wallet need to see this transfer
            for (const user of users) {
                // Initialize skipped transfers array if not exists
                if (!skippedTransfers.has(user.userId)) {
                    skippedTransfers.set(user.userId, []);
                }

                // Get the tracking start time (use different methods depending on what's available)
                const trackingStartTime = user.trackingStartedAt ||
                    (user.createdAt ? Math.floor(new Date(user.createdAt).getTime() / 1000) : null);

                // Skip if we don't have a valid start time
                if (!trackingStartTime) {
                    skippedTransfers.get(user.userId)!.push({
                        ...transfer,
                        reason: 'Cannot determine when tracking started'
                    });
                    continue;
                }

                // Only notify about transfers that happened AFTER the wallet was tracked
                if (transfer.blockTime <= trackingStartTime) {
                    skippedTransfers.get(user.userId)!.push({
                        ...transfer,
                        reason: 'Transfer occurred before wallet was tracked'
                    });
                    continue;
                }

                // Skip if we've already processed this block time
                if (user.lastBlockTime && transfer.blockTime <= user.lastBlockTime) {
                    skippedTransfers.get(user.userId)!.push({
                        ...transfer,
                        reason: 'Already processed transactions up to this block time'
                    });
                    continue;
                }

                // If this transfer is newer than the user's last known signature
                if (!user.lastSig || transfer.signature !== user.lastSig) {
                    // Check if this user has already processed this transfer in this cycle
                    const alreadyAdded = userNotifications.get(user.userId)?.
                        some(t => t.signature === transfer.signature);

                    if (!alreadyAdded) {
                        // Initialize array if not exists for this user
                        if (!userNotifications.has(user.userId)) {
                            userNotifications.set(user.userId, []);
                        }
                        // Add transfer to user's notifications list for this cycle
                        userNotifications.get(user.userId)!.push(transfer);
                    }
                } else {
                    // We've hit the transaction the user was last notified of
                    skippedTransfers.get(user.userId)!.push({
                        ...transfer,
                        reason: 'Already notified about this transfer'
                    });
                    // No need to process older transactions for this user
                    break;
                }
            }
        }

        // Send grouped notifications for each user
        for (const [userId, newTransfers] of userNotifications) {
            if (newTransfers.length > 0) {
                walletLog(walletAddress, userId, `Preparing to send notification for ${newTransfers.length} transfers`, {
                    signatures: newTransfers.map(t => t.signature)
                });

                // Format the summary message
                let message = `🔔 New transfers detected for wallet \`${walletAddress}\`:\n\n`;

                // Add details for each transfer (limit to 5 most recent)
                const transfersToShow = newTransfers.slice(0, 5);
                message += transfersToShow.map(formatTransfer).join('\n\n');

                // If there are more transfers, add a count
                if (newTransfers.length > 5) {
                    message += `\n\n...and ${newTransfers.length - 5} more transfers.`;
                }

                // Send the summary message
                await bot.sendMessage(userId, message, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });

                // Update the last notified signature with the newest transfer
                await updateLastNotifiedSignature(
                    db,
                    userId,
                    walletAddress,
                    newTransfers[0].signature,
                    newTransfers[0].blockTime
                );

                // Log the notification
                logTransferNotification(
                    walletAddress,
                    userId,
                    newTransfers,
                    skippedTransfers.get(userId)
                );
            } else {
                walletLog(walletAddress, userId, 'No new transfers to notify');
            }
        }
    } catch (error) {
        console.error(`Error checking wallet ${walletAddress}:`, error);
        walletLog(walletAddress, null, 'Error checking wallet activity', { error: String(error) });
    }
}

// Function to check for new transfers for all tracked wallets
export async function checkWalletActivity(db: any, specificWalletAddress?: string) {
    try {
        // Get all tracked wallets
        const trackedWallets = await getAllTrackedWalletsWithState(db);
        console.log(`Checking ${trackedWallets.length} tracked wallets...`);

        // Group wallets by address for efficiency
        const walletsByAddress = new Map<string, Array<{
            userId: number,
            lastSig: string | null,
            lastBlockTime: number | null,
            trackingStartedAt: number | null,
            createdAt: string
        }>>();

        for (const wallet of trackedWallets) {
            if (!walletsByAddress.has(wallet.wallet_address)) {
                walletsByAddress.set(wallet.wallet_address, []);
            }
            walletsByAddress.get(wallet.wallet_address)!.push({
                userId: wallet.user_id,
                lastSig: wallet.last_notified_tx_signature,
                lastBlockTime: wallet.last_processed_block_time,
                trackingStartedAt: wallet.tracking_started_at,
                createdAt: wallet.created_at
            });
        }

        // If a specific wallet address is provided, only check that one
        if (specificWalletAddress) {
            const users = walletsByAddress.get(specificWalletAddress);
            if (users) {
                await checkSingleWalletActivity(db, specificWalletAddress, users);
            } else {
                console.log(`No users are tracking wallet ${specificWalletAddress}`);
            }
            return;
        }

        // Check each unique wallet address
        for (const [walletAddress, users] of walletsByAddress) {
            await checkSingleWalletActivity(db, walletAddress, users);
            // Small delay between wallets to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Error in checkWalletActivity:', error);
    }
}

// Initialize the polling service
export async function startPollingService(db: any) {
    // Log all tracked wallets at startup
    try {
        const trackedWallets = await getAllTrackedWalletsWithState(db);
        console.log('\nCurrently tracked wallets:');
        if (trackedWallets.length === 0) {
            console.log('No wallets are currently being tracked.');
        } else {
            // Group wallets by user for better readability
            const walletsByUser = new Map<number, Array<{ address: string, createdAt: string }>>();
            for (const wallet of trackedWallets) {
                if (!walletsByUser.has(wallet.user_id)) {
                    walletsByUser.set(wallet.user_id, []);
                }
                walletsByUser.get(wallet.user_id)!.push({
                    address: wallet.wallet_address,
                    createdAt: wallet.created_at
                });
            }

            // Log each user's tracked wallets
            for (const [userId, wallets] of walletsByUser) {
                console.log(`\nUser ${userId} is tracking:`);
                wallets.forEach(wallet => {
                    console.log(`- ${wallet.address} (tracked since: ${wallet.createdAt})`);
                    walletLog(wallet.address, userId, 'Tracking resumed on bot startup', {
                        tracked_since: wallet.createdAt
                    });
                });
            }
        }
        console.log('\n');
    } catch (error) {
        console.error('Error logging tracked wallets:', error);
    }

    // Run every minute
    cron.schedule('* * * * *', () => {
        checkWalletActivity(db).catch(error => {
            console.error('Error in polling service:', error);
        });
    });

    console.log('Wallet activity polling service started');
} 