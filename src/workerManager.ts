import { Worker } from 'worker_threads';
import path from 'path';
import { EventEmitter } from 'events';

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
     * Start a worker thread
     * @param type Type of worker to start
     * @returns Promise that resolves when worker is ready
     */
    public async startWorker(type: WorkerType): Promise<Worker> {
        // Convert worker type to filename
        const workerFile = this.getWorkerFilename(type);
        const workerPath = path.resolve(__dirname, 'workers', workerFile);

        console.log(`Starting ${type} worker...`);

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
        }

        // Handle other message types
        this.emit(`${type}_message`, message);
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
                await this.sendAndWaitForResponse(
                    type,
                    { type: 'SETUP_BOT', data: { db: this.db } },
                    'BOT_SETUP_COMPLETE'
                );
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