import { VybeTransfer } from '../vybeApi'; // Assuming VybeTransfer is exported and useful
import { getAllTrackedWalletsWithState, updateLastNotifiedSignature /* , potentially new state update functions */ } from '../database';
import { walletLog, logTransferNotification } from '../logger';
import { SPAM_ADDRESSES } from '../constants';
import WorkerManager, { WorkerType } from '../workerManager'; // To send messages to Telegram worker

// Define expected structure for incoming WebSocket messages (adjust as needed)
// Based on Vybe docs or observed messages
interface WebSocketTransferMessage {
    type: 'transfer'; // Or whatever Vybe uses
    data: VybeTransfer & { /* any additional fields from WS */ };
    // Add other potential message types like 'trade', 'price'
}

// Store the last processed block time per user/wallet combo to prevent duplicates
// In-memory cache for simplicity, could be moved to DB for persistence across restarts
const lastProcessedBlockTimeCache: { [userWalletKey: string]: number } = {};

// Define the structure returned by getAllTrackedWalletsWithState
interface TrackedWalletState {
    user_id: number;
    wallet_address: string;
    last_notified_tx_signature: string | null;
    last_processed_block_time: number | null;
    tracking_started_at: number | null;
    created_at: string; // Assuming it's a string from the DB
    // Add other fields if returned by the query
}

function getUserWalletKey(userId: number, walletAddress: string): string {
    return `${userId}:${walletAddress}`;
}

class WalletActivityHandler {
    private db: any;
    private workerManager: WorkerManager;

    constructor(dbProxy: any, workerManager: WorkerManager) {
        this.db = dbProxy;
        this.workerManager = workerManager;
        console.log('[WalletActivityHandler] Initialized.');
    }

    /**
     * Handles incoming WebSocket messages.
     * Bound instance method to be passed to onMessageHandler.
     */
    public handleWebSocketMessage = async (message: any): Promise<void> => {
        // Remove the check for message.type, as it seems messages are top-level data
        if (typeof message !== 'object' || message === null) {
            // console.debug('[WalletActivityHandler] Received non-object message:', message);
            return;
        }

        // --- Check for Transfer-like structure directly --- 
        // Check for key fields expected in a transfer message
        if (message.signature && message.blockTime && message.senderAddress && message.receiverAddress) {
            console.log(`[WalletActivityHandler] Detected transfer-like message: ${message.signature}`);
            // Treat the message itself as the transfer data
            const transferData = message as (VybeTransfer & { blockTime: number });

            // --- Basic Validation (Redundant?) & Spam Check --- 
            // We already checked for key fields above, but keeping for safety
            if (!transferData.signature || !transferData.blockTime || !transferData.senderAddress || !transferData.receiverAddress) {
                console.warn('[WalletActivityHandler] Received incomplete transfer message (post-check):', transferData);
                return;
            }

            if (SPAM_ADDRESSES.includes(transferData.senderAddress) || SPAM_ADDRESSES.includes(transferData.receiverAddress)) {
                // console.debug(`[WalletActivityHandler] Skipping spam transfer: ${transferData.signature}`);
                return;
            }

            const involvedAddresses = [transferData.senderAddress, transferData.receiverAddress];
            const uniqueInvolvedAddresses = [...new Set(involvedAddresses)];

            try {
                const allTrackedWallets: TrackedWalletState[] = await getAllTrackedWalletsWithState(this.db);
                const relevantUsers = allTrackedWallets.filter((tracked: TrackedWalletState) =>
                    uniqueInvolvedAddresses.includes(tracked.wallet_address)
                );

                if (relevantUsers.length === 0) {
                    return;
                }

                for (const userWallet of relevantUsers) {
                    const userWalletKey = getUserWalletKey(userWallet.user_id, userWallet.wallet_address);
                    const trackingStartTime = userWallet.tracking_started_at ||
                        (userWallet.created_at ? Math.floor(new Date(userWallet.created_at).getTime() / 1000) : null);
                    const lastProcessedTime = lastProcessedBlockTimeCache[userWalletKey] || userWallet.last_processed_block_time || 0;

                    let shouldNotify = true;
                    let skipReason = '';

                    if (!trackingStartTime) {
                        shouldNotify = false;
                        skipReason = 'Cannot determine when tracking started';
                    } else if (transferData.blockTime <= trackingStartTime) {
                        shouldNotify = false;
                        skipReason = `Transfer time (${transferData.blockTime}) is before tracking start time (${trackingStartTime})`;
                    } else if (transferData.blockTime <= lastProcessedTime) {
                        shouldNotify = false;
                        skipReason = `Transfer time (${transferData.blockTime}) is not newer than last processed time (${lastProcessedTime})`;
                    }

                    if (shouldNotify) {
                        walletLog(userWallet.wallet_address, userWallet.user_id, 'Sending notification via WebSocket', { signature: transferData.signature, blockTime: transferData.blockTime });
                        const notificationPayload = {
                            userId: userWallet.user_id,
                            walletAddress: userWallet.wallet_address,
                            transfer: transferData,
                        };
                        this.workerManager.sendToWorker(WorkerType.TELEGRAM, {
                            type: 'SEND_WALLET_ACTIVITY_NOTIFICATION',
                            payload: notificationPayload
                        });
                        lastProcessedBlockTimeCache[userWalletKey] = transferData.blockTime;
                        updateLastNotifiedSignature(
                            this.db,
                            userWallet.user_id,
                            userWallet.wallet_address,
                            transferData.signature,
                            transferData.blockTime
                        ).catch(err => console.error("Error updating DB state for WS transfer:", err));
                    } else {
                        // console.debug(`[WalletActivityHandler] Skipping notification for user ${userWallet.user_id}, wallet ${userWallet.wallet_address}, transfer ${transferData.signature}. Reason: ${skipReason}`);
                    }
                }
            } catch (error) {
                console.error(`[WalletActivityHandler] Error processing transfer ${transferData.signature}:`, error);
            }
        }
        // --- Add checks for other potential message types (trades, prices) based on their unique fields --- 
        else if (message.marketId && message.maker && message.taker) { // Example check for a trade message
            console.log('[WalletActivityHandler] Received trade-like message (handling TBD):', message.signature || '(no signature)');
        } else if (message.priceFeedAccount && message.price) { // Example check for a price message
            console.log('[WalletActivityHandler] Received price-like message (handling TBD) for:', message.priceFeedAccount);
        } else {
            // console.debug('[WalletActivityHandler] Received message, but not identified as known type:', message);
        }
    }
}

export default WalletActivityHandler; 