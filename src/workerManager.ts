import { Worker } from 'worker_threads';
import path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs';

// Worker types
export enum WorkerType {
    TELEGRAM = 'telegram',
    TOKEN_PRICE = 'token_price',
    WALLET_ACTIVITY = 'wallet_activity',
    ALERT_PROCESSING = 'alert_processing'
}

// Worker manager events
export enum WorkerManagerEvent {
    WORKER_READY = 'worker_ready',
    WORKER_ERROR = 'worker_error',
    WORKER_EXIT = 'worker_exit',
    ALL_WORKERS_READY = 'all_workers_ready'
}

// Worker state
interface WorkerState {
    worker: Worker;
    isReady: boolean;
    type: WorkerType;
    startTime: number;
}

/**
 * Worker Manager to handle communication with worker threads
 */
export class WorkerManager extends EventEmitter {
    private workers: Map<WorkerType, WorkerState> = new Map();
    private isShuttingDown: boolean = false;
    private db: any;

    /**
     * Create a new WorkerManager
     * @param db Database connection to pass to workers
     */
    constructor(db: any) {
        super();
        this.db = db;
    }

    /**
     * Get the database connection
     * For use by methods handling DB requests from workers
     */
    public getDatabase() {
        return this.db;
    }

    /**
     * Start a worker thread
     * @param type Type of worker to start
     * @returns Promise that resolves when worker is ready
     */
    public async startWorker(type: WorkerType): Promise<Worker> {
        // Convert worker type to filename
        const workerFile = this.getWorkerFilename(type);

        // Try multiple potential locations for the worker file
        const potentialPaths = [
            // In the same directory as the manager (dist/workers/*.js)
            path.resolve(__dirname, 'workers', workerFile),

            // One directory up from current directory (src/workers/*.js)
            path.resolve(__dirname, '..', 'src', 'workers', workerFile),

            // Direct path from project root
            path.resolve(process.cwd(), 'dist', 'workers', workerFile),

            // Development path from project root
            path.resolve(process.cwd(), 'src', 'workers', workerFile)
        ];

        // Find the first path that exists
        let workerPath = '';
        for (const path of potentialPaths) {
            try {
                if (fs.existsSync(path)) {
                    workerPath = path;
                    break;
                }
            } catch (error) {
                // Ignore errors and try next path
            }
        }

        if (!workerPath) {
            // If no existing path found, default to the first one
            workerPath = potentialPaths[0];
        }

        console.log(`Starting ${type} worker...`);
        console.log(`Worker path: ${workerPath}`);

        return new Promise((resolve, reject) => {
            try {
                // Create worker
                const worker = new Worker(workerPath);

                // Save worker state
                this.workers.set(type, {
                    worker,
                    isReady: false,
                    type,
                    startTime: Date.now()
                });

                // Handle messages from worker
                worker.on('message', (message) => {
                    this.handleWorkerMessage(type, message);
                });

                // Handle errors
                worker.on('error', (error) => {
                    console.error(`Error in ${type} worker:`, error);
                    this.emit(WorkerManagerEvent.WORKER_ERROR, { type, error });

                    if (!this.isShuttingDown) {
                        // Restart worker on error
                        this.restartWorker(type);
                    }
                });

                // Handle worker exit
                worker.on('exit', (code) => {
                    console.log(`${type} worker exited with code ${code}`);
                    this.emit(WorkerManagerEvent.WORKER_EXIT, { type, code });

                    if (!this.isShuttingDown && code !== 0) {
                        // Restart worker on abnormal exit
                        this.restartWorker(type);
                    }
                });

                // Set timeout for worker ready
                const timeout = setTimeout(() => {
                    reject(new Error(`Timeout waiting for ${type} worker to be ready`));
                }, 30000);

                // Wait for worker to be ready
                this.once(`${type}_ready`, () => {
                    clearTimeout(timeout);
                    resolve(worker);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Get the worker filename based on type
     */
    private getWorkerFilename(type: WorkerType): string {
        switch (type) {
            case WorkerType.TELEGRAM:
                return 'telegramBotWorker.js';
            case WorkerType.TOKEN_PRICE:
                return 'tokenPriceWorker.js';
            case WorkerType.WALLET_ACTIVITY:
                return 'walletActivityWorker.js';
            case WorkerType.ALERT_PROCESSING:
                return 'alertProcessingWorker.js';
            default:
                throw new Error(`Unknown worker type: ${type}`);
        }
    }

    /**
     * Handle messages from workers
     */
    private handleWorkerMessage(type: WorkerType, message: any): void {
        // --- BEGIN ADDED LOG ---
        console.log(`[Manager] Received message from ${type} worker:`, message?.type);
        // --- END ADDED LOG ---

        // Handle DB requests from workers
        if (message.type === 'DB_REQUEST' && message.operation) {
            this.handleDatabaseRequest(type, message);
            return;
        }

        // Check if worker is ready
        if (message.type === 'WORKER_READY') {
            console.log(`${type} worker is ready`);
            const workerState = this.workers.get(type);
            if (workerState) {
                workerState.isReady = true;
            }

            this.emit(`${type}_ready`, { type });
            this.emit(WorkerManagerEvent.WORKER_READY, { type });

            // Check if all workers are ready
            this.checkAllWorkersReady();
            return; // Return after handling WORKER_READY
        }

        // --- BEGIN ADDED LOG for specific events ---
        if (message.type === 'PRICE_UPDATE' || message.type === 'PRICE_ALERT') {
            console.log(`[Manager] Processing ${message.type} from ${type} worker. Data:`, message);
        }
        // --- END ADDED LOG ---

        // Handle other message types by emitting them
        this.emit(`${type}_message`, message);
    }

    /**
     * Handle database requests from workers
     */
    private async handleDatabaseRequest(type: WorkerType, request: any): Promise<void> {
        const { requestId, operation, params } = request;
        const workerState = this.workers.get(type);

        if (!workerState) {
            console.error(`Worker ${type} not found for DB request`);
            return;
        }

        try {
            let result;

            // Execute the requested database operation
            switch (operation) {
                case 'all':
                    result = await this.db.all(...params);
                    break;

                case 'get':
                    result = await this.db.get(...params);
                    break;

                case 'run':
                    result = await this.db.run(...params);
                    break;

                default:
                    throw new Error(`Unknown database operation: ${operation}`);
            }

            // Send the result back to the worker
            workerState.worker.postMessage({
                type: 'DB_RESPONSE',
                requestId,
                result,
                error: null
            });
        } catch (error: any) {
            // Send error back to worker
            workerState.worker.postMessage({
                type: 'DB_RESPONSE',
                requestId,
                result: null,
                error: error.message
            });
        }
    }

    /**
     * Check if all workers are ready
     */
    private checkAllWorkersReady(): void {
        let allReady = true;

        for (const [_, state] of this.workers) {
            if (!state.isReady) {
                allReady = false;
                break;
            }
        }

        if (allReady && this.workers.size > 0) {
            this.emit(WorkerManagerEvent.ALL_WORKERS_READY);
        }
    }

    /**
     * Send a message to a worker
     */
    public sendToWorker(type: WorkerType, message: any): void {
        const workerState = this.workers.get(type);
        if (!workerState) {
            throw new Error(`Worker ${type} not found`);
        }

        workerState.worker.postMessage(message);
    }

    /**
     * Setup the Telegram Bot
     */
    public async setupTelegramBot(): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.TELEGRAM,
            { type: 'SETUP_BOT' },  // Don't send DB directly
            'BOT_SETUP_COMPLETE'
        ).then(() => { });
    }

    /**
     * Initialize the Token Price Service
     */
    public async initializeTokenPrices(): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.TOKEN_PRICE,
            { type: 'INITIALIZE' },
            'INITIALIZED'
        ).then(() => { });
    }

    /**
     * Start the Token Price Service
     */
    public async startTokenPriceService(): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.TOKEN_PRICE,
            { type: 'START_SERVICE' },
            'SERVICE_STARTED'
        ).then(() => { });
    }

    /**
     * Set up listener for price updates from the TokenPriceWorker
     */
    public setupPriceUpdateListener(callback: (data: any) => void): void {
        // --- BEGIN ADDED LOG ---
        console.log('[Manager] Setting up PriceUpdateListener...');
        // --- END ADDED LOG ---
        this.on(WorkerType.TOKEN_PRICE + '_message', (message) => {
            if (message.type === 'PRICE_UPDATE') {
                // --- BEGIN ADDED LOG ---
                console.log('[Manager] Emitting PRICE_UPDATE event to main thread listener.');
                // --- END ADDED LOG ---
                callback(message);
            }
        });
    }

    /**
     * Set up listener for price alerts from the TokenPriceWorker
     */
    public setupPriceAlertListener(callback: (alertType: string, token: any, data: any) => void): void {
        // --- BEGIN ADDED LOG ---
        console.log('[Manager] Setting up PriceAlertListener...');
        // --- END ADDED LOG ---
        this.on(WorkerType.TOKEN_PRICE + '_message', (message) => {
            if (message.type === 'PRICE_ALERT') {
                // --- BEGIN ADDED LOG ---
                console.log('[Manager] Emitting PRICE_ALERT event to main thread listener.');
                // --- END ADDED LOG ---
                callback(message.alertType, message.token, message.data);
            }
        });
    }

    /**
     * Start wallet activity polling
     */
    public async startWalletPolling(): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.WALLET_ACTIVITY,
            { type: 'START_POLLING' },
            'POLLING_STARTED'
        ).then(() => { });
    }

    /**
     * Stop wallet activity polling
     */
    public async stopWalletPolling(): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.WALLET_ACTIVITY,
            { type: 'STOP_POLLING' },
            'POLLING_STOPPED'
        ).then(() => { });
    }

    /**
     * Check a specific wallet for activity
     */
    public async checkWalletActivity(walletAddress: string): Promise<void> {
        return this.sendAndWaitForResponse(
            WorkerType.WALLET_ACTIVITY,
            {
                type: 'CHECK_WALLET',
                walletAddress
            },
            'WALLET_CHECKED'
        ).then(() => { });
    }

    /**
     * Setup wallet activity listener
     */
    public setupWalletActivityListener(callback: (walletAddress: string, activity: any) => void): void {
        this.on(`${WorkerType.WALLET_ACTIVITY}_message`, (message: any) => {
            if (message.type === 'WALLET_ACTIVITY') {
                callback(message.walletAddress, message.activity);
            }
        });
    }

    /**
     * Send a message to a worker and wait for a specific response
     */
    public sendAndWaitForResponse(type: WorkerType, message: any, expectedResponseType: string, timeout: number = 30000): Promise<any> {
        return new Promise((resolve, reject) => {
            const workerState = this.workers.get(type);
            if (!workerState) {
                reject(new Error(`Worker ${type} not found`));
                return;
            }

            // Set timeout
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout waiting for ${expectedResponseType} from ${type} worker`));
            }, timeout);

            // Handler for messages
            const messageHandler = (response: any) => {
                if (response.type === expectedResponseType) {
                    cleanup();
                    resolve(response);
                }
            };

            // Cleanup function
            const cleanup = () => {
                clearTimeout(timeoutId);
                this.removeListener(`${type}_message`, messageHandler);
            };

            // Register listener
            this.on(`${type}_message`, messageHandler);

            // Send message
            workerState.worker.postMessage(message);
        });
    }

    /**
     * Restart a worker
     */
    private async restartWorker(type: WorkerType): Promise<void> {
        console.log(`Restarting ${type} worker...`);

        // Remove existing worker
        const workerState = this.workers.get(type);
        if (workerState) {
            try {
                workerState.worker.terminate();
            } catch (error) {
                console.error(`Error terminating ${type} worker:`, error);
            }

            this.workers.delete(type);
        }

        // Start new worker
        try {
            await this.startWorker(type);

            // Init worker based on type
            if (type === WorkerType.TELEGRAM) {
                await this.setupTelegramBot();
            }
            // Add other worker type initializations as needed

            console.log(`${type} worker restarted successfully`);
        } catch (error) {
            console.error(`Failed to restart ${type} worker:`, error);
        }
    }

    /**
     * Shutdown all workers
     */
    public async shutdown(): Promise<void> {
        console.log('Shutting down all workers...');
        this.isShuttingDown = true;

        const shutdownPromises: Promise<void>[] = [];

        for (const [type, state] of this.workers) {
            shutdownPromises.push(
                new Promise<void>((resolve) => {
                    try {
                        // Special shutdown for Telegram bot
                        if (type === WorkerType.TELEGRAM) {
                            this.sendAndWaitForResponse(type, { type: 'SHUTDOWN' }, 'SHUTDOWN_COMPLETE', 5000)
                                .then(() => resolve())
                                .catch(() => {
                                    // Force terminate if timeout
                                    state.worker.terminate().then(() => resolve());
                                });
                        } else {
                            // Default termination for other workers
                            state.worker.terminate().then(() => resolve());
                        }
                    } catch (error) {
                        console.error(`Error during ${type} worker shutdown:`, error);
                        resolve(); // Resolve anyway to continue shutdown
                    }
                })
            );
        }

        await Promise.all(shutdownPromises);
        console.log('All workers shut down');
    }
}

export default WorkerManager; 