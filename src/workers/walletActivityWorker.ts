import { parentPort } from 'worker_threads';
import { checkWalletActivity } from '../pollingService';
import cron from 'node-cron';

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

// Track service state
let isServiceRunning = false;
let cronJob: cron.ScheduledTask | null = null;

// Handle database responses
port.on('message', (message) => {
    if (message.type === 'DB_RESPONSE') {
        dbProxy.handleResponse(message);
    }
});

// Forward wallet activity notifications to main thread
function forwardWalletActivity(walletAddress: string, activity: any) {
    port.postMessage({
        type: 'WALLET_ACTIVITY',
        walletAddress,
        activity,
        timestamp: Date.now()
    });
}

// Start polling for wallet activity
async function startPolling() {
    // Initialize by checking all wallets immediately
    // console.log('Worker: Performing initial wallet activity check...');
    await checkWalletActivity(dbProxy);

    // Setup cron job to check wallet activity periodically
    cronJob = cron.schedule('*/5 * * * *', async () => { // Every 5 minutes
        // console.log('Worker: Checking wallet activity (scheduled)...');
        try {
            await checkWalletActivity(dbProxy);
        } catch (error) {
            // console.error('Worker: Error in scheduled wallet check:', error);
        }
    });

    // console.log('Worker: Wallet activity polling service started');
}

// Stop polling for wallet activity
function stopPolling() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    isServiceRunning = false;
    // console.log('Worker: Wallet activity polling service stopped');
}

// Handle messages from the main thread
port.on('message', async (message) => {
    try {
        switch (message.type) {
            case 'START_POLLING':
                // console.log('Worker: Starting wallet activity polling...');
                // Mark as running and send response immediately to avoid timeout
                isServiceRunning = true;
                port.postMessage({
                    type: 'POLLING_STARTED',
                    timestamp: Date.now()
                });

                // Then perform the initial check (which might take time)
                startPolling().catch(error => {
                    // console.error('Worker: Error starting polling:', error);
                    port.postMessage({
                        type: 'ERROR',
                        error: String(error),
                        timestamp: Date.now()
                    });
                });
                break;

            case 'STOP_POLLING':
                // console.log('Worker: Stopping wallet activity polling...');
                stopPolling();
                port.postMessage({
                    type: 'POLLING_STOPPED',
                    timestamp: Date.now()
                });
                break;

            case 'CHECK_WALLET':
                // console.log(`Worker: Checking specific wallet: ${message.walletAddress}`);
                try {
                    await checkWalletActivity(dbProxy, message.walletAddress);
                    port.postMessage({
                        type: 'WALLET_CHECKED',
                        walletAddress: message.walletAddress,
                        timestamp: Date.now()
                    });
                } catch (error: any) {
                    port.postMessage({
                        type: 'WALLET_CHECK_ERROR',
                        walletAddress: message.walletAddress,
                        error: error.message,
                        timestamp: Date.now()
                    });
                }
                break;

            case 'SHUTDOWN':
                // console.log('Worker: Shutting down wallet activity service...');
                stopPolling();
                port.postMessage({
                    type: 'SHUTDOWN_COMPLETE',
                    timestamp: Date.now()
                });
                break;

            default:
                // Skip DB_RESPONSE messages as they're handled separately
                if (message.type !== 'DB_RESPONSE') {
                    // console.warn(`Worker: Unknown message type: ${message.type}`);
                }
        }
    } catch (error: any) {
        // console.error('Worker: Error processing message:', error);
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
    // console.error('Worker: Uncaught exception:', error);
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
    workerType: 'wallet_activity',
    timestamp: Date.now()
});

// console.log('Wallet activity worker started and ready to receive messages'); 