import fs from 'fs';
import path from 'path';

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Writes a log entry to a wallet-specific log file
 * @param walletAddress The wallet address to log for
 * @param userId The user ID that's tracking the wallet (optional)
 * @param message The log message
 * @param data Additional data to log (optional)
 */
export function walletLog(walletAddress: string, userId: number | null, message: string, data?: any) {
    try {
        // Use both ISO string (for human readability) and Unix timestamp (for consistency)
        const timestamp = new Date();
        const isoTimestamp = timestamp.toISOString();
        const unixTimestamp = Math.floor(timestamp.getTime() / 1000);

        // Add Unix timestamp to the data if provided
        if (data) {
            data._timestamp_unix = unixTimestamp;
        }

        const logEntry = {
            timestamp: isoTimestamp,
            timestamp_unix: unixTimestamp,
            userId,
            message,
            data
        };

        // Create wallet-specific log file
        const walletFileName = `${walletAddress.substring(0, 8)}_${walletAddress.slice(-4)}.log`;
        const logPath = path.join(LOGS_DIR, walletFileName);

        // Append to the log file
        const logString = `[${isoTimestamp}] ${userId ? `User: ${userId} ` : ''}${message}${data ? `\nData: ${JSON.stringify(data, null, 2)}` : ''}\n\n`;
        fs.appendFileSync(logPath, logString);

        // Also print to console for visibility
        console.log(`[Wallet: ${walletAddress.substring(0, 4)}...${walletAddress.slice(-4)}] ${message}`);
    } catch (error) {
        console.error('Error writing to wallet log:', error);
    }
}

/**
 * Creates or updates a transfer log tracking all notifications sent
 * @param walletAddress Wallet address
 * @param userId User ID
 * @param transfers List of transfers that were notified
 * @param skippedTransfers Optional list of transfers that were skipped
 */
export function logTransferNotification(
    walletAddress: string,
    userId: number,
    transfers: any[],
    skippedTransfers?: any[]
) {
    // Log the notification
    walletLog(
        walletAddress,
        userId,
        `Sent notification for ${transfers.length} transfers`,
        {
            notifiedTransfers: transfers.map(t => ({
                signature: t.signature,
                blockTime: t.blockTime, // Include the raw Unix timestamp
                time: new Date(t.blockTime * 1000).toISOString(), // Keep ISO for readability
                amount: t.amount
            })),
            skippedCount: skippedTransfers?.length || 0
        }
    );

    // If there were skipped transfers, log them too
    if (skippedTransfers && skippedTransfers.length > 0) {
        walletLog(
            walletAddress,
            userId,
            `Skipped ${skippedTransfers.length} transfers`,
            skippedTransfers.map(t => ({
                signature: t.signature,
                blockTime: t.blockTime, // Include the raw Unix timestamp
                time: new Date(t.blockTime * 1000).toISOString(), // Keep ISO for readability
                reason: t.reason
            }))
        );
    }
} 