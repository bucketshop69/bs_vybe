import 'dotenv/config';
import { initializeDatabase } from './database';
import WorkerManager, { WorkerType, WorkerManagerEvent } from './workerManager';

/**
 * Start the application with worker threads
 */
async function startApp() {
    console.log('Starting Vybe Bot application with worker threads...');

    // Initialize the database
    console.log('Initializing database...');
    const db = await initializeDatabase();

    // Create worker manager
    console.log('Creating worker manager...');
    const workerManager = new WorkerManager(db);

    // Listen for all workers ready
    workerManager.once(WorkerManagerEvent.ALL_WORKERS_READY, () => {
        console.log('✅ Vybe Bot is now running in worker threads mode!');
        console.log('🔔 Token price alerts are active');
        console.log('📈 Wallet activity tracking is active');
    });

    // Start the Telegram bot worker first (for demonstration)
    console.log('Starting Telegram bot worker...');
    await workerManager.startWorker(WorkerType.TELEGRAM);

    // Initialize the Telegram bot
    console.log('Setting up Telegram bot...');
    await workerManager.sendAndWaitForResponse(
        WorkerType.TELEGRAM,
        { type: 'SETUP_BOT', data: { db } },
        'BOT_SETUP_COMPLETE'
    );

    // Once we have more workers implemented, we would start them here:
    // await workerManager.startWorker(WorkerType.TOKEN_PRICE);
    // await workerManager.startWorker(WorkerType.WALLET_ACTIVITY);
    // await workerManager.startWorker(WorkerType.ALERT_PROCESSING);

    console.log('All workers started successfully');

    // Graceful shutdown handler
    process.on('SIGINT', async () => {
        console.log('Shutting down gracefully...');

        // Shutdown all workers
        await workerManager.shutdown();

        console.log('Goodbye!');
        process.exit(0);
    });
}

// Start the application
startApp().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
}); 