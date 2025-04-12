import 'dotenv/config';
import { bot, setupBot } from './telegram';
import { initializeDatabase } from './database';
import { startPollingService } from './pollingService';

async function startApp() {
    // Initialize the database
    const db = await initializeDatabase();

    // Start the wallet activity polling service
    await startPollingService(db);

    // Setup the bot commands and handlers
    setupBot(db);

    console.log('TypeScript Node.js project is running with Telegram bot!');
}

// Start the application
startApp().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
}); 