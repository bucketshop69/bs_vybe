import { parentPort } from 'worker_threads';

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

// Handle messages from the main thread
port.on('message', async (message) => {
    try {
        switch (message.type) {
            case 'DB_RESPONSE':
                dbProxy.handleResponse(message);
                break;

            case 'SHUTDOWN':
                // console.log('Worker: Shutting down wallet activity service...');
                isServiceRunning = false;
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

// Log when worker starts successfully
port.postMessage({ type: 'WORKER_STARTED', timestamp: Date.now() });

// Initial check (Optional - can be removed if CHECK_WALLET is the only entry point)
// console.log('Worker: Performing initial wallet activity check on startup...');
// checkWalletActivity(dbProxy).catch(error => {
//     console.error('Worker: Error during initial wallet check:', error);
// });

// console.log('Wallet activity worker started and ready to receive messages'); 