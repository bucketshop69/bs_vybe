import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv'; // Good practice to load .env file

dotenv.config(); // Load environment variables from .env file

if (!process.env.VYBE_TELEGRAM_BOT_TOKEN) {
    throw new Error('VYBE_TELEGRAM_BOT_TOKEN is required in your .env file');
}

// ****** IMPORTANT ******
// Use the channel username (including the '@') or the numerical channel ID.
// Add this to your .env file: CHANNEL_USERNAME=@bs_vybe_test
if (!process.env.CHANNEL_USERNAME) {
    throw new Error('CHANNEL_USERNAME is required in your .env file (e.g., @bs_vybe_test)');
}

// You might still want a specific chat ID for sending *admin alerts* or direct messages
// from the bot, but it's distinct from the channel ID for broadcasting.
// Let's keep it for now, but clarify its purpose.
if (!process.env.ADMIN_CHAT_ID) { // Renamed for clarity
    console.warn('ADMIN_CHAT_ID is not set. Needed for admin-specific messages.');
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

const TARGET_CHANNEL_ID = process.env.CHANNEL_USERNAME; // Use the username directly

// --- Function to send message specifically TO THE CHANNEL ---
async function sendToChannel(message: string) {
    if (!TARGET_CHANNEL_ID) {
        console.error("Cannot send to channel: CHANNEL_USERNAME is not defined.");
        return;
    }
    try {
        await bot.sendMessage(TARGET_CHANNEL_ID, message, { parse_mode: 'Markdown' }); // Or 'HTML'
        console.log(`Message sent successfully to channel: ${TARGET_CHANNEL_ID}`);
    } catch (error) {
        console.error(`Failed to send message to channel ${TARGET_CHANNEL_ID}:`, error);
    }
}

// --- Example: Trigger sending to channel via a command (for testing) ---
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const messageToSend = match ? match[1] : null; // Extract text after /broadcast

    // Optional: Restrict who can use this command (e.g., only admin)
    // if (String(chatId) !== process.env.ADMIN_CHAT_ID) {
    //     await bot.sendMessage(chatId, "Sorry, you don't have permission to broadcast.");
    //     return;
    // }

    if (messageToSend) {
        await sendToChannel(`📢 Broadcast from Admin:\n\n${messageToSend}`);
        await bot.sendMessage(chatId, "Message broadcasted to the channel!"); // Confirm back to the user who sent command
    } else {
        await bot.sendMessage(chatId, "Please provide a message to broadcast. Usage: /broadcast Your message here");
    }
});


// Handle /start command (remains the same - replies to user)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log('Received /start command from chatId:', chatId);
    await bot.sendMessage(chatId, `Bot is connected and ready! 🚀\nUse commands or interact. To test channel posting, use /broadcast <your message here> (if enabled).`);
});

// Handle any other message (remains the same - replies to user)
// Consider removing this general echo handler later unless needed
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    // Avoid processing commands already handled by onText
    if (msg.text && !msg.text.startsWith('/start') && !msg.text.startsWith('/broadcast')) {
        console.log(`Received message from ${chatId}: ${msg.text}`);
        // Decide if you want to echo back or do something else
        // await bot.sendMessage(chatId, `Received your message: ${msg.text}`);
    }
});

// Error handling (remains the same)
bot.on('error', (error) => {
    console.error('Telegram bot error:', error);
});
bot.on('polling_error', (error) => {
    console.error('Telegram bot polling error:', error);
});

console.log(`Bot started... Now listening for commands.`);
// Example: Send a message to the channel when the bot starts (optional)
// sendToChannel("🤖 Bot is now online and connected to this channel!");

// Export the bot instance if needed by other modules, and the function
export { bot, sendToChannel };