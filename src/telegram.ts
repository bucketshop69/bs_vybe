import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getRankedDexData, formatDigestMessage } from './vybeApi';

dotenv.config();

if (!process.env.VYBE_TELEGRAM_BOT_TOKEN) {
    throw new Error('VYBE_TELEGRAM_BOT_TOKEN is required in your .env file');
}

// Create bot instance
const bot = new TelegramBot(process.env.VYBE_TELEGRAM_BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log('Received /start command from chatId:', chatId);
    await bot.sendMessage(chatId, `Bot is connected and ready! 🚀\nUse /testdigest to test the DEX data functionality.`);
});

// Handle /testdigest command
bot.onText(/\/testdigest/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await bot.sendMessage(chatId, "Fetching DEX data and preparing digest...");

        // Get the ranked data
        const rankedData = await getRankedDexData();
        if (!rankedData || rankedData.length === 0) {
            throw new Error('No DEX data available');
        }

        // Format the message
        const message = formatDigestMessage(rankedData);

        // Send the digest directly to the user
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        await bot.sendMessage(chatId, "✅ Digest generated successfully!");
    } catch (error) {
        console.error('Error in /testdigest command:', error);
        await bot.sendMessage(chatId, `❌ Error generating digest: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('Telegram bot error:', error);
});
bot.on('polling_error', (error) => {
    console.error('Telegram bot polling error:', error);
});

console.log(`Bot started... Now listening for commands.`);

// Export the bot instance
export { bot };