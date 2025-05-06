import 'dotenv/config';
import { initializeDatabase } from './database';
import WorkerManager, { WorkerType, WorkerManagerEvent } from './workerManager';
import { startKolRankingService } from './kolRankingService';
import { vybeWebSocketService } from './services/vybeWebSocket';
import { generateCurrentFilters } from './filterService';
import { appEvents, EVENT_TRACKED_WALLETS_CHANGED } from './appEvents';
import WalletActivityHandler from './services/walletActivityHandler';

// --- WebSocket Filter Update Handler ---
// Debounce state for filter updates
let filterUpdateTimeout: NodeJS.Timeout | null = null;
const FILTER_UPDATE_DEBOUNCE_MS = 2500; // 2.5 seconds debounce

async function handleFilterUpdate(db: any) {
    if (filterUpdateTimeout) {
        clearTimeout(filterUpdateTimeout);
    }

    filterUpdateTimeout = setTimeout(async () => {
        filterUpdateTimeout = null;
        try {
            const newFilters = await generateCurrentFilters(db);
            vybeWebSocketService.stopWebSocket();
            await new Promise(resolve => setTimeout(resolve, 500));

            if (Object.keys(newFilters).length > 0) {
                vybeWebSocketService.startWebSocket(newFilters);
            } else {
                console.warn('[Index] No filters generated, WebSocket not restarted.');
            }
        } catch (error) {
            console.error('[Index] Error during handleFilterUpdate:', error);
        }
    }, FILTER_UPDATE_DEBOUNCE_MS);
}

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

    // --- Initialize WebSocket Service EARLY ---
    // Needs to be initialized before listeners are set up
    console.log('[Index] Initializing WebSocket Service...');
    vybeWebSocketService.initialize(); // Reads API key from process.env.VYBE_KEY

    // --- Setup Event Listener for Filter Updates ---
    console.log('[Index] Setting up listener for tracked wallet changes...');
    appEvents.on(EVENT_TRACKED_WALLETS_CHANGED, () => {
        console.log('[Index] EVENT_TRACKED_WALLETS_CHANGED received, scheduling filter update.');
        handleFilterUpdate(db).catch(err => console.error("[Index] Error scheduling filter update:", err));
    });

    // Create worker manager
    console.log('Creating worker manager...');
    const workerManager = new WorkerManager(db);

    // --- Instantiate Wallet Activity Handler ---
    console.log('[Index] Initializing Wallet Activity Handler...');
    const walletActivityHandler = new WalletActivityHandler(db, workerManager);

    // --- Register WebSocket Message Handlers ---
    console.log('[Index] Registering WebSocket message handlers...');
    vybeWebSocketService.onMessageHandler(walletActivityHandler.handleWebSocketMessage);

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

        // --- Start WebSocket Service (Initial Filters) ---
        // Call handleFilterUpdate *once* after init to set initial filters
        console.log('[Index] Setting initial WebSocket filters...');
        await handleFilterUpdate(db);
        // Note: Depending on timing, might need await here or ensure handleFilterUpdate completes before proceeding

        // Start the Token Price worker
        console.log('Starting Token Price worker...');
        await workerManager.startWorker(WorkerType.TOKEN_PRICE);

        // Initialize token prices
        console.log('Initializing token prices...');
        await workerManager.initializeTokenPrices();

        // Set up price update and alert listeners
        console.log('Setting up price event listeners...');
        workerManager.setupPriceUpdateListener((data) => {
            // TODO: Add logic here to potentially forward updates (e.g., to Telegram users requesting live prices)
        });

        workerManager.setupPriceAlertListener((alertType, token, data) => {
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
                    payload.isAboveTarget = data.userAlert.is_above_target;
                } else if (alertType === 'general' && Array.isArray(data?.userIds) && data.userIds.length > 0) {
                    userIds = data.userIds;
                    payload.percentChange = data.percentChange;
                    payload.previousPrice = data.previousPrice;
                } else {
                    console.warn('[Index] Could not determine target user IDs for price alert. Skipping notification.', { alertType, token, data });
                    return;
                }

                payload.userIds = userIds;
                const message = {
                    type: 'SEND_PRICE_ALERT_NOTIFICATION',
                    payload: payload
                };

                workerManager.sendToWorker(WorkerType.TELEGRAM, message);
            } catch (error) {
                console.error('[Index] Error processing price alert for notification:', error, { alertType, token, data });
            }
        });

        // Start the token price service
        console.log('Starting token price service...');
        await workerManager.startTokenPriceService();

        // Start the Wallet Activity worker
        console.log('Starting Wallet Activity worker...');
        await workerManager.startWorker(WorkerType.WALLET_ACTIVITY);

        // Set up wallet activity listener
        workerManager.setupWalletActivityListener((walletAddress, activity) => {
            console.log(`Wallet activity detected for ${walletAddress}:`, activity);
        });

        // Start the KOL ranking check service
        console.log('Starting KOL ranking service...');
        await startKolRankingService(db);

        console.log('All services and workers started successfully');
    } catch (error) {
        console.error('Error starting workers or services:', error);
        process.exit(1);
    }

    // Graceful shutdown handler
    process.on('SIGINT', async () => {
        console.log('Shutting down gracefully...');

        // Stop WebSocket Service first
        vybeWebSocketService.stopWebSocket();

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