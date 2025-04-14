import { parentPort } from 'worker_threads';
import { bot, setupBot } from '../telegram';

// Ensure we have the parent port
if (!parentPort) {
    throw new Error('This module must be run as a worker thread!');
}

// Get a reference to ensure it's not null in callbacks
const port = parentPort;

// Handle messages from the main thread
port.on('message', async (message) => {
    try {
        switch (message.type) {
            case 'SETUP_BOT':
                console.log('Worker: Setting up Telegram bot...');
                setupBot(message.data.db);
                port.postMessage({
                    type: 'BOT_SETUP_COMPLETE',
                    timestamp: Date.now()
                });
                break;

            case 'SHUTDOWN':
                console.log('Worker: Shutting down Telegram bot...');
                bot.stopPolling();
                port.postMessage({
                    type: 'SHUTDOWN_COMPLETE',
                    timestamp: Date.now()
                });
                break;

            default:
                console.warn(`Worker: Unknown message type: ${message.type}`);
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