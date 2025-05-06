import { parentPort } from 'worker_threads';
import {
    initializeTokenPrices,
    startTokenPriceService,
    registerAlertCallback,
    registerPriceUpdateCallback,
    stopTokenPriceService
} from '../services/tokenPriceService';

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

// Track if we've already initialized
let isInitialized = false;
let isServiceRunning = false;

// Handle database responses
port.on('message', (message) => {
    if (message.type === 'DB_RESPONSE') {
        dbProxy.handleResponse(message);
    }
});

// Forward price updates to main thread
function forwardPriceUpdate(token: any, changeData: any) {
    // console.log(`[Worker] Forwarding PRICE_UPDATE for ${token?.symbol || 'Unknown Token'}. Data:`, { token, changeData });
    port.postMessage({
        type: 'PRICE_UPDATE',
        token,
        changeData,
        timestamp: Date.now()
    });
}

// Forward price alerts to main thread
async function forwardPriceAlert(alertType: string, token: any, data: any): Promise<void> {
    // console.log(`[Worker] Forwarding PRICE_ALERT (${alertType}) for ${token?.symbol || 'Unknown Token'}. Data:`, { alertType, token, data });
    port.postMessage({
        type: 'PRICE_ALERT',
        alertType,
        token,
        data,
        timestamp: Date.now()
    });
}

// Register callback handlers that forward to main thread
const registerCallbacks = () => {
    // Register price update callback
    registerPriceUpdateCallback(forwardPriceUpdate);

    // Register alert callback
    registerAlertCallback(forwardPriceAlert);

    // console.log('Worker: Registered callbacks for price updates and alerts');
};

// Handle messages from the main thread
port.on('message', async (message) => {
    try {
        switch (message.type) {
            case 'INITIALIZE':
                // console.log('Worker: Initializing token price service...');
                if (!isInitialized) {
                    await initializeTokenPrices(dbProxy);
                    isInitialized = true;
                    registerCallbacks();
                }
                port.postMessage({
                    type: 'INITIALIZED',
                    timestamp: Date.now()
                });
                break;

            case 'START_SERVICE':
                // console.log('Worker: Starting token price service...');
                if (!isServiceRunning) {
                    await startTokenPriceService(dbProxy);
                    isServiceRunning = true;
                }
                port.postMessage({
                    type: 'SERVICE_STARTED',
                    timestamp: Date.now()
                });
                break;

            case 'SHUTDOWN':
                // console.log('Worker: Shutting down token price service...');
                if (isServiceRunning) {
                    stopTokenPriceService();
                    isServiceRunning = false;
                }
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
    workerType: 'token_price',
    timestamp: Date.now()
});

// console.log('Token price worker started and ready to receive messages'); 