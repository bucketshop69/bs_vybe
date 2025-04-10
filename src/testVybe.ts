import dotenv from 'dotenv';
import TelegramBot = require('node-telegram-bot-api');
import { getRankedDexData, formatDigestMessage } from './vybeApi';

// Load environment variables
dotenv.config();

// Check required environment variables
const requiredEnvVars = [
    'VYBE_TELEGRAM_BOT_TOKEN',
    'TELEGRAM_GROUP_ID',
    'VYBE_DIGEST_TOPIC_ID',
    'BOT_COMMAND_TOPIC_ID',
    'VYBE_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    process.exit(1);
}

console.log('✅ All required environment variables are present');

// Initialize bot
const bot = new TelegramBot(process.env.VYBE_TELEGRAM_BOT_TOKEN!, { polling: false });

// Helper function to safely convert string to number
const safeParseInt = (str: string | undefined): number | undefined => {
    if (!str) return undefined;
    const num = parseInt(str, 10);
    return isNaN(num) ? undefined : num;
};

// Send test messages
const testMessages = async () => {
    try {
        // Generate and send the Vybe Digest
        console.log('Generating Vybe Digest...');
        const rankedData = await getRankedDexData();
        const digestMessage = formatDigestMessage(rankedData);

        console.log('Attempting to send Vybe Digest to topic...');
        console.log('Using topic ID:', process.env.VYBE_DIGEST_TOPIC_ID);
        const digestResult = await bot.sendMessage(
            process.env.TELEGRAM_GROUP_ID!,
            digestMessage,
            {
                message_thread_id: safeParseInt(process.env.VYBE_DIGEST_TOPIC_ID),
                parse_mode: 'Markdown'
            }
        );
        console.log('✅ Vybe Digest sent successfully!');
        console.log('Message ID:', digestResult.message_id);

        // Test message to BOT_COMMAND_TOPIC_ID
        console.log('\nAttempting to send test message to Bot Command topic...');
        console.log('Using topic ID:', process.env.BOT_COMMAND_TOPIC_ID);
        console.log('Using chat ID:', process.env.TELEGRAM_GROUP_ID);
        const commandResult = await bot.sendMessage(
            process.env.TELEGRAM_GROUP_ID!,
            '🤖 Test message from Vybe Bot\nThis is a test message to verify the bot configuration in the Bot Command topic.',
            {
                message_thread_id: safeParseInt(process.env.BOT_COMMAND_TOPIC_ID)
            }
        );
        console.log('✅ Test message sent successfully to Bot Command topic!');
        console.log('Message ID:', commandResult.message_id);
    } catch (error: any) {
        console.error('❌ Failed to send message:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Response:', error.response);
        process.exit(1);
    }
};

// Run the test
testMessages(); 