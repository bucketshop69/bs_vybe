import 'dotenv/config';
import { initializeDatabase } from './database';
import WorkerManager, { WorkerType, WorkerManagerEvent } from './workerManager';

/**
 * Start the application with worker threads
 */
async function startApp() {
    console.log('Starting Vybe Bot application with worker threads...');

    // Validate required environment variables
    if (!process.env.VYBE_TELEGRAM_BOT_TOKEN) {
        throw new Error('FATAL: VYBE_TELEGRAM_BOT_TOKEN is required in .env');
    }

    if (!process.env.VYBE_KEY) {
        throw new Error('FATAL: VYBE_KEY is required in .env');
    }

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

    try {
        // Start the Telegram bot worker
        console.log('Starting Telegram bot worker...');
        await workerManager.startWorker(WorkerType.TELEGRAM);

        // Initialize the Telegram bot without passing DB directly
        console.log('Setting up Telegram bot...');
        await workerManager.setupTelegramBot();

        // Start the Token Price worker
        console.log('Starting Token Price worker...');
        await workerManager.startWorker(WorkerType.TOKEN_PRICE);

        // Initialize token prices
        console.log('Initializing token prices...');
        await workerManager.initializeTokenPrices();

        // Set up price update and alert listeners
        console.log('Setting up price event listeners...');
        workerManager.setupPriceUpdateListener((data) => {
            console.log('Price update received:', data);
            // TODO: Add logic here to potentially forward updates (e.g., to Telegram users requesting live prices)
        });

        workerManager.setupPriceAlertListener((alertType, token, data) => {
            console.log(`[Index] Price alert (${alertType}) received for ${token?.symbol}. Data:`, data);

            // --- BEGIN: Construct and send alert notification message --- 
            try {
                let userIds: number[] = [];
                const payload: any = {
                    alertType: alertType,
                    tokenSymbol: token?.symbol,
                    currentPrice: token?.current_price,
                };

                if (alertType === 'target' && data?.userAlert?.user_id) {
                    userIds = [data.userAlert.user_id];
                    payload.targetPrice = data.userAlert.target_price;
                    payload.isAboveTarget = data.userAlert.is_above_target; // Include direction for better message formatting
                } else if (alertType === 'general' && Array.isArray(data?.userIds) && data.userIds.length > 0) {
                    userIds = data.userIds;
                    payload.percentChange = data.percentChange;
                    payload.previousPrice = data.previousPrice;
                } else {
                    console.warn('[Index] Could not determine target user IDs for price alert. Skipping notification.', { alertType, token, data });
                    return; // Don't proceed if no valid recipients
                }

                payload.userIds = userIds;

                // Construct the message to send to the Telegram worker
                const message = {
                    type: 'SEND_PRICE_ALERT_NOTIFICATION',
                    payload: payload
                };

                console.log(`[Index] Sending alert message to Telegram worker:`, message);
                workerManager.sendToWorker(WorkerType.TELEGRAM, message);

            } catch (error) {
                console.error('[Index] Error processing price alert for notification:', error, { alertType, token, data });
            }
            // --- END: Construct and send alert notification message ---
        });

        // Start the token price service
        console.log('Starting token price service...');
        await workerManager.startTokenPriceService();

        // Start the Wallet Activity worker
        console.log('Starting Wallet Activity worker...');
        await workerManager.startWorker(WorkerType.WALLET_ACTIVITY);

        // Start wallet activity polling
        console.log('Starting wallet activity polling...');
        await workerManager.startWalletPolling();

        // Set up wallet activity listener
        workerManager.setupWalletActivityListener((walletAddress, activity) => {
            console.log(`Wallet activity detected for ${walletAddress}:`, activity);
        });

        // Once we have more workers implemented, we would start them here:
        // await workerManager.startWorker(WorkerType.ALERT_PROCESSING);

        console.log('All workers started successfully');
    } catch (error) {
        console.error('Error starting workers:', error);
        process.exit(1);
    }

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