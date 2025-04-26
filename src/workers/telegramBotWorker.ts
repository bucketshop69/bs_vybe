import { parentPort } from 'worker_threads';
import { bot, setupBot } from '../telegram';

// Ensure we have the parent port
if (!parentPort) {
    throw new Error('This module must be run as a worker thread!');
}

// Get a reference to ensure it's not null in callbacks
const port = parentPort;

// Create a database proxy that forwards requests to the main thread
const dbProxy = {
    // Track request IDs for responses
    nextRequestId: 1,
    pendingRequests: new Map(),

    // Proxy database methods
    all: async function (...params: any[]) {
        return this.sendDbRequest('all', params);
    },

    get: async function (...params: any[]) {
        return this.sendDbRequest('get', params);
    },

    run: async function (...params: any[]) {
        return this.sendDbRequest('run', params);
    },

    // Send a database request to the main thread
    sendDbRequest: function (operation: string, params: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestId = this.nextRequestId++;

            // Save the promise callbacks
            this.pendingRequests.set(requestId, { resolve, reject });

            // Send request to main thread
            port.postMessage({
                type: 'DB_REQUEST',
                requestId,
                operation,
                params
            });
        });
    },

    // Handle response from main thread
    handleResponse: function (response: any) {
        const { requestId, result, error } = response;
        const request = this.pendingRequests.get(requestId);

        if (request) {
            this.pendingRequests.delete(requestId);

            if (error) {
                request.reject(new Error(error));
            } else {
                request.resolve(result);
            }
        }
    }
};

// Handle database responses
port.on('message', (message) => {
    if (message.type === 'DB_RESPONSE') {
        dbProxy.handleResponse(message);
    }
});

// Handle messages from the main thread
port.on('message', async (message) => {
    try {
        switch (message.type) {
            case 'SETUP_BOT':
                console.log('Setting up telegram bot...');
                setupBot(dbProxy);

                // Remove explicit polling start since it's handled in setupBot
                port.postMessage({ type: 'BOT_SETUP_COMPLETE' });
                break;

            case 'SHUTDOWN':
                console.log('Shutting down telegram bot worker...');

                // Stop polling before shutdown to prevent conflicts
                bot.stopPolling().then(() => {
                    port.postMessage({ type: 'SHUTDOWN_COMPLETE' });
                    process.exit(0);
                });
                break;

            case 'SEND_PRICE_ALERT_NOTIFICATION':
                console.log('[TelegramWorker] Received SEND_PRICE_ALERT_NOTIFICATION:', message.payload);
                const { payload } = message;

                if (!payload || !Array.isArray(payload.userIds) || payload.userIds.length === 0) {
                    console.warn('[TelegramWorker] Invalid or missing user IDs in alert payload. Skipping.');
                    return;
                }

                let formattedMessage = '🚨 **Price Alert!** 🚨\n\n';
                const tokenSymbol = payload.tokenSymbol || 'Unknown Token';
                const currentPrice = typeof payload.currentPrice === 'number' ? payload.currentPrice.toFixed(6) : 'N/A';

                if (payload.alertType === 'target') {
                    const targetPrice = typeof payload.targetPrice === 'number' ? payload.targetPrice.toFixed(6) : 'N/A';
                    const direction = payload.isAboveTarget ? 'above' : 'below';
                    formattedMessage += `Token *${tokenSymbol}* crossed ${direction} target of *$${targetPrice}*\n`;
                    formattedMessage += `Current Price: *$${currentPrice}*`;
                } else if (payload.alertType === 'general') {
                    const percentChange = typeof payload.percentChange === 'number' ? payload.percentChange.toFixed(2) : 'N/A';
                    const sign = payload.percentChange >= 0 ? '+' : '';
                    formattedMessage += `Token *${tokenSymbol}* changed by *${sign}${percentChange}%*\n`;
                    formattedMessage += `Current Price: *$${currentPrice}*`;
                } else {
                    formattedMessage += `Token *${tokenSymbol}* updated.\nCurrent Price: *$${currentPrice}*`;
                    console.warn(`[TelegramWorker] Unknown alertType: ${payload.alertType}`);
                }

                // Send the message to each relevant user
                for (const userId of payload.userIds) {
                    try {
                        console.log(`[TelegramWorker] Sending alert to user ${userId}`);
                        await bot.sendMessage(userId, formattedMessage, { parse_mode: 'Markdown' });
                    } catch (error: any) {
                        // Handle potential errors like user blocking the bot
                        console.error(`[TelegramWorker] Failed to send alert to user ${userId}:`, error.message || error);
                        // Consider adding logic here to mark the user as inactive or handle specific error codes
                    }
                }
                break;

            default:
                // Skip DB_RESPONSE messages as they're handled separately
                if (message.type !== 'DB_RESPONSE') {
                    console.warn(`Worker: Unknown message type: ${message.type}`);
                }
        }
    } catch (error: any) {
        console.error('Worker: Error processing message:', error);
        port.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack,
            timestamp: Date.now()
        });
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
    console.error('Worker: Uncaught exception:', error);
    port.postMessage({
        type: 'UNCAUGHT_EXCEPTION',
        error: error.message,
        stack: error.stack,
        timestamp: Date.now()
    });
});

// Let the main thread know we're ready
port.postMessage({
    type: 'WORKER_READY',
    workerType: 'telegram',
    timestamp: Date.now()
});

console.log('Telegram bot worker started and ready to receive messages'); 