import { bot } from './telegram';
import { generatePriceBoardImage } from './utils/imageGenerator';
import { getRankedDexData, formatDigestMessage } from './vybeApi';
import { getAllUserIds } from './db/database';
import { FOUR_HOURS, TWELVE_HOURS, SEND_DELAY } from './config';

/**
 * Sends the price board image to all users
 */
async function sendPriceBoardToAllUsers(db: any) {
    try {
        console.log('Starting price board broadcast...');
        const userIds = await getAllUserIds(db);
        console.log(`Broadcasting price board to ${userIds.length} users`);

        // Generate image once for all users
        const imageBuffer = await generatePriceBoardImage();

        let successCount = 0;
        let errorCount = 0;

        for (const userId of userIds) {
            try {
                await bot.sendPhoto(userId, imageBuffer, {
                    caption: 'Latest Solana Token Prices ✨'
                });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
            } catch (error: any) {
                errorCount++;
                console.error(`Failed to send price board to user ${userId}:`, error.message || error);

                // If user blocked the bot, log it
                if (error.response?.statusCode === 403 || error.message?.includes('Forbidden')) {
                    console.log(`User ${userId} blocked the bot`);
                }
            }
        }

        console.log(`Price board broadcast completed. Success: ${successCount}, Errors: ${errorCount}`);
    } catch (error) {
        console.error('Error in price board broadcast:', error);
    }
}

/**
 * Sends the digest message to all users
 */
async function sendDigestToAllUsers(db: any) {
    try {
        console.log('Starting digest broadcast...');
        const userIds = await getAllUserIds(db);
        console.log(`Broadcasting digest to ${userIds.length} users`);

        // Get and format digest data once for all users
        const rankedData = await getRankedDexData();
        if (!rankedData || rankedData.length === 0) {
            throw new Error('No DEX data available');
        }
        const message = formatDigestMessage(rankedData);

        let successCount = 0;
        let errorCount = 0;

        for (const userId of userIds) {
            try {
                await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
            } catch (error: any) {
                errorCount++;
                console.error(`Failed to send digest to user ${userId}:`, error.message || error);

                // If user blocked the bot, log it
                if (error.response?.statusCode === 403 || error.message?.includes('Forbidden')) {
                    console.log(`User ${userId} blocked the bot`);
                }
            }
        }

        console.log(`Digest broadcast completed. Success: ${successCount}, Errors: ${errorCount}`);
    } catch (error) {
        console.error('Error in digest broadcast:', error);
    }
}

/**
 * Starts the scheduler for automated broadcasts
 */
export function startScheduler(db: any, bot: any) {
    console.log('Starting automated broadcast scheduler...');

    // Calculate next run times based on current time
    const now = Date.now();

    // Calculate next run times
    const nextPriceBoard = now + FOUR_HOURS;
    const nextDigest = now + TWELVE_HOURS;

    // Set up price board interval
    setInterval(() => {
        console.log('Starting price board broadcast...');
        sendPriceBoardToAllUsers(db);
    }, FOUR_HOURS);

    // Set up digest interval
    setInterval(() => {
        console.log('Starting digest broadcast...');
        sendDigestToAllUsers(db);
    }, TWELVE_HOURS);

    // Log next scheduled times
    console.log('Scheduler started successfully');
    console.log('Next scheduled broadcasts:');
    console.log(`- Price board: ${new Date(nextPriceBoard).toLocaleString()}`);
    console.log(`- Digest: ${new Date(nextDigest).toLocaleString()}`);
} 