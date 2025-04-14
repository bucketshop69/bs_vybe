import 'dotenv/config';
import { bot, setupBot } from './telegram';
import { initializeDatabase } from './database';
import { startPollingService } from './pollingService';
import { initializeTokenPrices, startTokenPriceService } from './tokenPriceService';
import { initializeTokenAlerts } from './tokenAlerts';

async function startApp() {
    console.log('Starting Vybe Bot application...');

    // Initialize the database
    console.log('Initializing database...');
    const db = await initializeDatabase();


    // Initialize token prices and alert systems
    console.log('Initializing token price service...');
    await initializeTokenPrices(db);

    // Initialize token alerts (this will register callbacks with the price service)
    console.log('Initializing token alert system...');
    initializeTokenAlerts();

    // Start the wallet activity polling service
    console.log('Starting wallet polling service...');
    await startPollingService(db);

    // Start the token price polling service
    console.log('Starting token price service...');
    await startTokenPriceService(db);

    // Setup the bot commands and handlers
    console.log('Setting up Telegram bot commands...');
    setupBot(db);

    console.log('✅ Vybe Bot is now running!');
    console.log('🔔 Token price alerts are active');
    console.log('📈 Wallet activity tracking is active');
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');

    // Close telegram bot 
    bot.stopPolling();

    // You can add any cleanup here

    console.log('Goodbye!');
    process.exit(0);
});

// Start the application
startApp().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
}); 