import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getRankedDexData, formatDigestMessage } from './vybeApi';
import { addTrackedWallet } from './database';

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

// Replace startBot function with setupBot that accepts db parameter
export function setupBot(db: any) {
    // Handle /start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        console.log('Received /start command from chatId:', chatId);
        await bot.sendMessage(chatId, `Bot is connected and ready! 🚀\nUse /testdigest to test the DEX data functionality.\nUse /track_wallet <address> to track a wallet for transfers.`);
    });

    // Handle /track_wallet command
    bot.onText(/\/track_wallet (.+)/, async (msg, match) => {
        if (!match) {
            await bot.sendMessage(msg.chat.id, '❌ Please provide a wallet address to track.');
            return;
        }

        const chatId = msg.chat.id;
        const walletAddress = match[1];

        // Basic Solana address validation (44 characters, base58)
        if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(walletAddress)) {
            await bot.sendMessage(chatId, '❌ Invalid Solana wallet address. Please provide a valid 44-character base58 address.');
            return;
        }

        try {
            await addTrackedWallet(db, chatId, walletAddress);
            await bot.sendMessage(chatId, `✅ Now tracking wallet \`${walletAddress}\` for new transfers. You'll get alerts here.`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error in /track_wallet command:', error);
            await bot.sendMessage(chatId, `❌ Error tracking wallet: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
}

// Export the bot instance
export { bot };