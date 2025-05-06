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
    private lastProcessedBlockTimeCache: { [key: string]: number } = {};

    constructor(db: any, workerManager: WorkerManager) {
        this.db = db;
        this.workerManager = workerManager;
        console.log('[WalletActivityHandler] Initialized.');
    }

    /**
     * Handles incoming WebSocket messages.
     * Bound instance method to be passed to onMessageHandler.
     */
    public handleWebSocketMessage = async (message: any): Promise<void> => {
        const transferData = message as VybeTransfer;

        if (!transferData || !transferData.signature) {
            return;
        }

        try {
            const trackedWallets = await getAllTrackedWalletsWithState(this.db);

            for (const userWallet of trackedWallets) {
                const userWalletKey = `${userWallet.user_id}_${userWallet.wallet_address}`;
                const lastProcessedBlockTime = this.lastProcessedBlockTimeCache[userWalletKey] || 0;

                let shouldNotify = false;
                let skipReason = '';

                if (transferData.blockTime <= lastProcessedBlockTime) {
                    skipReason = 'Already processed this block';
                } else if (SPAM_ADDRESSES.includes(transferData.senderAddress) || SPAM_ADDRESSES.includes(transferData.receiverAddress)) {
                    skipReason = 'Spam address detected';
                } else if (transferData.senderAddress === userWallet.wallet_address || transferData.receiverAddress === userWallet.wallet_address) {
                    shouldNotify = true;
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
                    this.lastProcessedBlockTimeCache[userWalletKey] = transferData.blockTime;
                    updateLastNotifiedSignature(
                        this.db,
                        userWallet.user_id,
                        userWallet.wallet_address,
                        transferData.signature,
                        transferData.blockTime
                    ).catch(err => console.error("Error updating DB state for WS transfer:", err));
                }
            }
        } catch (error) {
            console.error(`[WalletActivityHandler] Error processing transfer ${transferData.signature}:`, error);
        }
    }
}

export default WalletActivityHandler; 