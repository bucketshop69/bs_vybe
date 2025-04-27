import { bot } from './telegram';
import { TokenPrice, UserPriceAlert } from './database';
import { PriceAlertCallback, registerAlertCallback } from './tokenPriceService';
import { PRICE_ALERT_CONFIG } from './config';

// Track when we last sent notifications to avoid spamming
const lastAlertsSent: {
    [key: string]: {
        [userId: number]: number
    }
} = {};

// Queue for batching notifications to avoid API rate limits
interface QueuedNotification {
    userId: number;
    message: string;
    isHtml: boolean;
    retryCount: number;
}

const notificationQueue: QueuedNotification[] = [];
let processingQueue = false;
let queueProcessorTimer: NodeJS.Timeout | null = null;

// Notification settings
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RETRY_COUNT = 3;
const QUEUE_PROCESS_INTERVAL_MS = 1000; // Process queue every 1 second
const NOTIFICATION_DELAY_MS = 50; // Delay between sending messages to avoid Telegram rate limits

/**
 * Initialize the token alert system
 */
export function initializeTokenAlerts(): void {
    // Register the alert handler with the price service
    registerAlertCallback(handlePriceAlert);

    // Start the notification queue processor
    startQueueProcessor();

    console.log('Token alert system initialized');
}

/**
 * Start the notification queue processor
 */
function startQueueProcessor(): void {
    if (queueProcessorTimer) {
        clearInterval(queueProcessorTimer);
    }

    queueProcessorTimer = setInterval(processNotificationQueue, QUEUE_PROCESS_INTERVAL_MS);
    console.log('Notification queue processor started');
}

/**
 * Stop the notification queue processor
 */
export function stopNotificationSystem(): void {
    if (queueProcessorTimer) {
        clearInterval(queueProcessorTimer);
        queueProcessorTimer = null;
        console.log('Notification queue processor stopped');
    }
}

/**
 * Process the notification queue
 */
async function processNotificationQueue(): Promise<void> {
    if (processingQueue || notificationQueue.length === 0) {
        return;
    }

    processingQueue = true;

    try {
        // Process up to 10 notifications at a time
        const batchSize = Math.min(10, notificationQueue.length);

        for (let i = 0; i < batchSize; i++) {
            const notification = notificationQueue.shift();
            if (!notification) break;

            try {
                await bot.sendMessage(notification.userId, notification.message, {
                    parse_mode: notification.isHtml ? 'HTML' : undefined,
                    disable_web_page_preview: true
                });

                // Add delay between messages
                await new Promise(resolve => setTimeout(resolve, NOTIFICATION_DELAY_MS));
            } catch (error) {
                console.error(`Error sending notification to user ${notification.userId}:`, error);

                // Retry failed notifications
                if (notification.retryCount < MAX_RETRY_COUNT) {
                    notification.retryCount++;
                    // Put back in the queue with exponential backoff
                    setTimeout(() => {
                        notificationQueue.push(notification);
                    }, 1000 * Math.pow(2, notification.retryCount));
                } else {
                    console.error(`Failed to send notification to user ${notification.userId} after ${MAX_RETRY_COUNT} attempts`);
                }
            }
        }
    } finally {
        processingQueue = false;
    }
}

/**
 * Format a percentage change with appropriate indicator
 * @param percent Percentage change value
 * @returns Formatted string with emoji
 */
function formatPercentChange(percent: number): string {
    const sign = percent >= 0 ? '+' : '';
    let emoji = '⚪️';

    if (percent > 5) emoji = '🟢';
    else if (percent > 0) emoji = '🟩';
    else if (percent < -5) emoji = '🔴';
    else if (percent < 0) emoji = '🟥';

    return `${sign}${percent.toFixed(2)}% ${emoji}`;
}

/**
 * Format a price value with appropriate precision
 * @param price The price value to format
 * @returns Formatted price string
 */
function formatPrice(price: number): string {
    if (price >= 1000) return `$${price.toFixed(2)}`;
    if (price >= 100) return `$${price.toFixed(3)}`;
    if (price >= 1) return `$${price.toFixed(4)}`;
    if (price >= 0.01) return `$${price.toFixed(6)}`;
    return `$${price.toFixed(8)}`;
}

/**
 * Format a general price movement alert message
 * @param token Token data 
 * @param percentChange Percentage change
 * @param previousPrice Previous price
 * @returns Formatted message
 */
function formatGeneralAlertMessage(
    token: TokenPrice,
    percentChange: number,
    previousPrice: number
): string {
    const direction = percentChange >= 0 ? 'increased' : 'decreased';
    const timeframe = '60 minutes'; // Based on our polling interval
    const currentPrice = token?.current_price || 0;

    let message = `🚨 <b>Price Alert: ${token.symbol}</b> 🚨\n\n`;
    message += `The price of <b>${token.name}</b> has ${direction} by <b>${formatPercentChange(percentChange)}</b> in the last ${timeframe}.\n\n`;
    message += `• Current Price: <b>${formatPrice(currentPrice)}</b>\n`;
    message += `• Previous Price: ${formatPrice(previousPrice)}\n`;
    message += `• Change: ${formatPercentChange(percentChange)}\n\n`;

    // Add quick tips
    if (percentChange >= 0) {
        message += `📈 <i>Consider setting a price target alert if you want to take profit.</i>`;
    } else {
        message += `📉 <i>Consider setting a price target alert if you want to buy the dip.</i>`;
    }

    return message;
}

/**
 * Format a targeted price alert message
 * @param token Token data
 * @param alert User's price alert that was triggered
 * @returns Formatted message
 */
function formatTargetAlertMessage(
    token: TokenPrice,
    alert: UserPriceAlert
): string {
    const crossedDirection = alert.is_above_target ? 'risen above' : 'fallen below';
    const currentPrice = token?.current_price || 0;

    let message = `🎯 <b>Price Target Reached: ${token.symbol}</b> 🎯\n\n`;
    message += `The price of <b>${token.name}</b> has ${crossedDirection} your target of <b>${formatPrice(alert.target_price)}</b>.\n\n`;
    message += `• Current Price: <b>${formatPrice(currentPrice)}</b>\n`;
    message += `• Target Price: ${formatPrice(alert.target_price)}\n\n`;

    // Add action suggestions
    if (alert.is_above_target) {
        message += `💰 <i>Your price target has been reached! This might be a good time to evaluate your position.</i>`;
    } else {
        message += `💸 <i>Your price target has been reached! This might be a good entry point if you're still interested.</i>`;
    }

    return message;
}

/**
 * Format a message for the public digest in group chats
 * @param token Token data
 * @param percentChange Percentage change
 * @returns Formatted message for group digest
 */
function formatGroupDigestMessage(
    token: TokenPrice,
    percentChange: number
): string {
    let emoji = '⚪️';

    if (percentChange > 10) emoji = '🚀';
    else if (percentChange > 5) emoji = '🟢';
    else if (percentChange > 0) emoji = '🟩';
    else if (percentChange < -10) emoji = '💥';
    else if (percentChange < -5) emoji = '🔴';
    else if (percentChange < 0) emoji = '🟥';

    const sign = percentChange >= 0 ? '+' : '';
    const currentPrice = token?.current_price || 0;

    return `${emoji} <b>${token.symbol}</b>: ${formatPrice(currentPrice)} (${sign}${percentChange.toFixed(2)}%)`;
}

/**
 * Check if we should throttle alerts for a token/user combination
 * @param mintAddress Token mint address
 * @param userId User ID
 * @returns True if alerts should be throttled
 */
function shouldThrottleAlerts(mintAddress: string, userId: number): boolean {
    const now = Date.now();

    // Initialize token entry if it doesn't exist
    if (!lastAlertsSent[mintAddress]) {
        lastAlertsSent[mintAddress] = {};
    }

    // Check if we've sent an alert recently
    const lastSent = lastAlertsSent[mintAddress][userId] || 0;
    if (now - lastSent < ALERT_COOLDOWN_MS) {
        return true;
    }

    // Update last sent time
    lastAlertsSent[mintAddress][userId] = now;
    return false;
}

/**
 * Send a notification to a user
 * @param userId User's Telegram ID
 * @param message Message to send
 * @param isHtml Whether the message contains HTML formatting
 * @returns True if message was queued
 */
function queueNotification(
    userId: number,
    message: string,
    isHtml: boolean = true
): boolean {
    try {
        notificationQueue.push({
            userId,
            message,
            isHtml,
            retryCount: 0
        });
        return true;
    } catch (error) {
        console.error(`Error queueing notification for user ${userId}:`, error);
        return false;
    }
}

/**
 * Send a notification to the group channel if configured
 * @param message Message to send
 * @param topicId Optional topic ID for forum channels
 * @returns True if message was queued
 */
function queueGroupNotification(
    message: string,
    topicId?: number
): boolean {
    // Get group chat ID from environment
    const groupChatId = process.env.TELEGRAM_GROUP_ID;
    if (!groupChatId) {
        // Just log at debug level since this is optional functionality
        console.debug('Group notifications not configured: TELEGRAM_GROUP_ID not set in environment');
        return false;
    }

    try {
        notificationQueue.push({
            userId: parseInt(groupChatId),
            message,
            isHtml: true,
            retryCount: 0
        });

        // If we have a topic ID and we're in a forum channel
        if (topicId) {
            // Modify the last added notification to include the topic
            const lastNotification = notificationQueue[notificationQueue.length - 1];
            bot.sendMessage(lastNotification.userId, lastNotification.message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: topicId
            }).then(() => {
                // Remove from queue since we sent it directly
                notificationQueue.pop();
            }).catch((error) => {
                console.error(`Error sending to topic ${topicId}:`, error);
                // Keep in queue for normal processing
            });
        }

        return true;
    } catch (error) {
        console.error(`Error queueing group notification:`, error);
        return false;
    }
}

/**
 * Send price digest to the group channel if configured
 * @param tokens Array of tokens with significant price changes
 * @param period Time period for the changes (e.g., '1 hour', '24 hours')
 * @returns True if digest was sent or queued
 */
export async function sendPriceDigest(
    tokens: Array<{ token: TokenPrice, percentChange: number }>,
    period: string
): Promise<boolean> {
    if (tokens.length === 0) return false;

    // Get group chat ID and digest topic ID from environment
    const groupChatId = process.env.TELEGRAM_GROUP_ID;
    const digestTopicId = process.env.VYBE_DIGEST_TOPIC_ID ?
        parseInt(process.env.VYBE_DIGEST_TOPIC_ID) : undefined;

    if (!groupChatId) {
        // Just log at debug level since this is optional functionality
        console.debug('Price digest not sent: TELEGRAM_GROUP_ID not set in environment');
        return false;
    }

    try {
        // Sort by absolute percentage change (descending)
        tokens.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));

        let message = `<b>🔄 Price Update (${period})</b>\n\n`;

        // Add each token to the digest
        tokens.forEach(({ token, percentChange }) => {
            message += formatGroupDigestMessage(token, percentChange) + '\n';
        });

        // Add footer
        message += '\n<i>Use /set_alert to create price target notifications</i>';

        // Send to the group (with topic ID if available)
        await bot.sendMessage(parseInt(groupChatId), message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            message_thread_id: digestTopicId
        });

        console.log(`Sent price digest to group ${groupChatId}${digestTopicId ? `, topic ${digestTopicId}` : ''}`);
        return true;
    } catch (error) {
        console.error('Error sending price digest:', error);
        return false;
    }
}

/**
 * Handle price alerts from the token price service
 * @param alertType Type of alert (general or target)
 * @param token Token data
 * @param data Additional alert data
 */
const handlePriceAlert: PriceAlertCallback = async (alertType, token, data) => {
    try {
        if (alertType === 'general' && data.percentChange !== undefined &&
            data.previousPrice !== undefined && data.userIds && data.userIds.length > 0) {

            // Format the general price movement alert message
            const message = formatGeneralAlertMessage(
                token,
                data.percentChange,
                data.previousPrice
            );

            // Send to all subscribers (with throttling)
            let queuedCount = 0;
            for (const userId of data.userIds) {
                // Skip if we've sent an alert recently to this user for this token
                if (shouldThrottleAlerts(token.mint_address, userId)) {
                    continue;
                }

                const queued = queueNotification(userId, message);
                if (queued) {
                    queuedCount++;
                    // Log the successful queuing of the notification
                    const currentTime = new Date().toLocaleString(); // Human-readable local time
                    console.log(
                        `[Price Alert Sent] Time: ${currentTime}, User: ${userId}, Token: ${token.symbol}, ` +
                        `Current Price: ${token.current_price.toFixed(6)}, Previous Price: ${data.previousPrice.toFixed(6)}`
                    );
                }
            }

            console.log(`Queued general price alerts for ${token.symbol} to ${queuedCount}/${data.userIds.length} users`);

            // For significant price movements, also post to the group chat if configured
            if (Math.abs(data.percentChange) >= 10 && process.env.TELEGRAM_GROUP_ID) {
                const groupMessage = `<b>🚨 Significant Price Movement</b>\n\n${formatGroupDigestMessage(token, data.percentChange)}`;
                queueGroupNotification(groupMessage);
            }
        }
        else if (alertType === 'target' && data.userAlert) {
            // Format the targeted price alert message
            const message = formatTargetAlertMessage(token, data.userAlert);

            // No throttling for target alerts as they're one-time events
            const queued = queueNotification(data.userAlert.user_id, message);

            console.log(
                `Queued price target alert for ${token.symbol} to user ${data.userAlert.user_id}: ` +
                `${queued ? 'Success' : 'Failed'}`
            );
        }
    } catch (error) {
        console.error('Error handling price alert:', error);
    }
};

/**
 * Send a test price alert to a user
 * @param userId User's Telegram ID
 * @param token Token data
 * @returns True if test alerts were queued
 */
export async function sendTestPriceAlerts(userId: number, token: TokenPrice): Promise<boolean> {
    try {
        // Mock data for test alerts
        const currentPrice = token?.current_price || 0;
        const mockPercentChange = 4.75;
        const mockPreviousPrice = currentPrice * (1 - mockPercentChange / 100);

        // Send a test general price alert
        const generalMessage = formatGeneralAlertMessage(
            token,
            mockPercentChange,
            mockPreviousPrice
        );

        queueNotification(userId,
            '📊 <b>TEST ALERT - General Price Movement</b>\n\n' + generalMessage
        );

        // Send a test target price alert
        const mockTargetAlert: UserPriceAlert = {
            id: 0,
            user_id: userId,
            mint_address: token.mint_address,
            target_price: currentPrice * 1.05, // 5% higher
            is_above_target: true,
            is_triggered: false,
            created_at: new Date().toISOString()
        };

        const targetMessage = formatTargetAlertMessage(token, mockTargetAlert);

        queueNotification(userId,
            '📊 <b>TEST ALERT - Price Target Reached</b>\n\n' + targetMessage
        );

        // Force queue processing immediately
        await processNotificationQueue();

        return true;
    } catch (error) {
        console.error('Error sending test price alerts:', error);
        return false;
    }
}

/**
 * Get estimated time until a price target might be reached
 * Based on recent price movement trends
 * @param currentPrice Current token price 
 * @param targetPrice Target price
 * @param recentHourlyChange Recent hourly percentage change
 * @returns Estimated time in hours or null if can't be estimated
 */
export function estimateTimeToTarget(
    currentPrice: number,
    targetPrice: number,
    recentHourlyChange: number
): number | null {
    // If the price isn't moving, we can't estimate
    if (recentHourlyChange === 0) return null;

    // If the price is moving in the wrong direction
    const priceDirection = targetPrice > currentPrice ? 1 : -1;
    const changeDirection = recentHourlyChange > 0 ? 1 : -1;

    if (priceDirection !== changeDirection) return null;

    // Calculate percentage difference to target
    const percentDiff = Math.abs((targetPrice - currentPrice) / currentPrice * 100);

    // Estimate hours based on current rate of change
    return Math.ceil(percentDiff / Math.abs(recentHourlyChange));
}

/**
 * Format a human-readable time estimate
 * @param hours Estimated hours
 * @returns Human readable time estimate
 */
export function formatTimeEstimate(hours: number): string {
    if (hours < 1) return 'less than an hour';
    if (hours < 24) return `about ${hours} hour${hours > 1 ? 's' : ''}`;

    const days = Math.floor(hours / 24);
    return `about ${days} day${days > 1 ? 's' : ''}`;
}

/**
 * Create a validation error message for price alerts
 * @param token Token data
 * @param targetPrice Requested target price
 * @returns Error message or null if valid
 */
export function validatePriceTarget(
    token: TokenPrice,
    targetPrice: number
): string | null {
    const currentPrice = token?.current_price || 0;

    // Check if the target is too close to current price
    const percentDiff = Math.abs((targetPrice - currentPrice) / currentPrice * 100);

    if (percentDiff < PRICE_ALERT_CONFIG.tooCloseThresholdPercent) {
        return `⚠️ Target price is too close to current price (${formatPrice(currentPrice)}). Please set a target at least ${PRICE_ALERT_CONFIG.tooCloseThresholdPercent}% away.`;
    }

    // Check if target is unrealistically far
    if (percentDiff > PRICE_ALERT_CONFIG.tooFarThresholdPercent) {
        return `⚠️ Target price is very far from current price (${formatPrice(currentPrice)}). Are you sure you want to set a target ${percentDiff.toFixed(0)}% ${targetPrice > currentPrice ? 'higher' : 'lower'}?`;
    }

    return null;
}
