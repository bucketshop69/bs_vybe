import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getRankedDexData, formatDigestMessage, getTokenBySymbolOrAddress } from './vybeApi';
import {
    addTrackedWallet,
    getUserTrackedWallets,
    removeTrackedWallet,
    subscribeToTokenAlerts,
    getUserTokenSubscriptions,
    getTokenSubscriptionCount,
    createPriceAlert,
    getUserPriceAlerts,
    removePriceAlert,
    getTokenPrice
} from './database';
import { getTokenPriceChange } from './tokenPriceService';
import { PRICE_ALERT_CONFIG } from './config';
import { sendTestPriceAlerts, estimateTimeToTarget, formatTimeEstimate, validatePriceTarget } from './tokenAlerts';

dotenv.config();

if (!process.env.VYBE_TELEGRAM_BOT_TOKEN) {
    throw new Error('VYBE_TELEGRAM_BOT_TOKEN is required in your .env file');
}

// Create bot instance
const bot = new TelegramBot(process.env.VYBE_TELEGRAM_BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: false,
        params: {
            timeout: 10
        }
    }
});

// Track if bot is already polling
let isPolling = false;

// Map to track users waiting for wallet addresses
const usersWaitingForWallet = new Map<number, boolean>();
const usersWaitingToRemoveWallet = new Map<number, boolean>();
// Map to track users waiting for token input
const usersWaitingForToken = new Map<number, boolean>();
// Map to track users waiting for alert token and price
const usersWaitingForAlertToken = new Map<number, boolean>();
const usersWaitingForAlertPrice = new Map<number, { token: string }>();
// Map to track users waiting for alert ID to remove
const usersWaitingToRemoveAlert = new Map<number, boolean>();

// Set up the commands that will appear in the menu
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and see available commands' },
    { command: 'track_wallet', description: 'Track a Solana wallet' },
    { command: 'track_token', description: 'Track a token for price alerts' },
    { command: 'set_alert', description: 'Set price target alert for a token' },
]).then(() => {
    console.log('Bot commands menu set successfully');
}).catch((error) => {
    console.error('Error setting bot commands:', error);
});

// Replace startBot function with setupBot that accepts db parameter
export function setupBot(db: any) {
    // Only start polling if not already polling
    if (!isPolling) {
        bot.startPolling().then(() => {
            isPolling = true;
            console.log('Bot polling started successfully');
        }).catch((error) => {
            console.error('Error starting bot polling:', error);
            // If it's a conflict error, try to stop polling first
            if (error.response?.body?.error_code === 409) {
                console.log('Bot already polling, attempting to stop and restart...');
                bot.stopPolling().then(() => {
                    bot.startPolling().then(() => {
                        isPolling = true;
                        console.log('Bot polling restarted successfully');
                    });
                });
            }
        });
    }

    // Handle /start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        console.log('Received /start command from chatId:', chatId);
        await bot.sendMessage(chatId,
            `🚀 <b>Welcome to the bs_vybe Bot!</b> 🚀\n\n` +

            `<b>📱 WALLET TRACKING</b>\n` +
            `/track_wallet - Track a Solana wallet\n` +
            `/my_wallets - View your tracked wallets\n` +
            `/remove_wallet- Stop tracking a wallet\n\n` +

            `<b>💰 TOKEN PRICE ALERTS</b>\n` +
            `/track_token - Get notified about price movements\n` +
            `  Example: /track_token SOL or /track_token 6p6xgHy...\n\n` +

            `/set_alert - Get notified when price reaches target\n` +
            `  Example: /set_alert SOL 100 or /set_alert BONK 0.00001\n\n` +

            `/my_alerts - View your active price alerts\n` +
            `/remove_alert <code>id</code> - Remove a specific price alert\n\n` +

            `<b>ℹ️ OTHER COMMANDS</b>\n` +
            `/testdigest - Test the DEX data functionality\n` +
            `/help - Show this message again\n\n` +

            `<b>🔔 ABOUT PRICE ALERTS:</b>\n` +
            `• General alerts trigger when price changes by ${PRICE_ALERT_CONFIG.generalAlertThresholdPercent}% or more\n` +
            `• Price target alerts trigger when a token crosses your specified price\n` +
            `• You can set up to ${PRICE_ALERT_CONFIG.maxAlertsPerUser} price alerts`,
            { parse_mode: 'HTML' }
        );
    });

    // Add a /help command that shows the same information as /start
    bot.onText(/\/help/, async (msg) => {
        // Just call the same code that /start would call
        const chatId = msg.chat.id;
        console.log('Received /help command from chatId:', chatId);
        await bot.sendMessage(chatId,
            `🚀 <b>Welcome to the Vybe Bot!</b> 🚀\n\n` +

            `<b>📱 WALLET TRACKING</b>\n` +
            `/track_wallet - Track a Solana wallet\n` +
            `/my_wallets - View your tracked wallets\n` +
            `/remove_wallet - Stop tracking a wallet\n\n` +

            `<b>💰 TOKEN PRICE ALERTS</b>\n` +
            `/track_token <code>symbol/address</code> - Get notified about price movements\n` +
            `  Example: /track_token SOL or /track_token 6p6xgHy...\n\n` +

            `/set_alert <code>symbol/address</code> <code>targetPrice</code> - Get notified when price reaches target\n` +
            `  Example: /set_alert SOL 100 or /set_alert BONK 0.00001\n\n` +

            `/my_alerts - View your active price alerts\n` +
            `/remove_alert <code>id</code> - Remove a specific price alert\n\n` +

            `<b>ℹ️ OTHER COMMANDS</b>\n` +
            `/testdigest - Test the DEX data functionality\n` +
            `/help - Show this message again\n\n` +

            `<b>🔔 ABOUT PRICE ALERTS:</b>\n` +
            `• General alerts trigger when price changes by ${PRICE_ALERT_CONFIG.generalAlertThresholdPercent}% or more\n` +
            `• Price target alerts trigger when a token crosses your specified price\n` +
            `• You can set up to ${PRICE_ALERT_CONFIG.maxAlertsPerUser} price alerts`,
            { parse_mode: 'HTML' }
        );
    });

    // Handle /track_wallet command
    bot.onText(/\/track_wallet/, async (msg) => {
        const chatId = msg.chat.id;

        // Set user as waiting for wallet address
        usersWaitingForWallet.set(chatId, true);

        await bot.sendMessage(
            chatId,
            '🔍 Please paste the Solana wallet address you want to track.\n\n',
            { parse_mode: 'Markdown' }
        );
    });

    // Handle /remove_wallet command
    bot.onText(/\/remove_wallet/, async (msg) => {
        const chatId = msg.chat.id;

        // Set user as waiting to remove wallet
        usersWaitingToRemoveWallet.set(chatId, true);

        await bot.sendMessage(
            chatId,
            '🔍 Please paste the Solana wallet address you want to stop tracking.\n\n',
            { parse_mode: 'Markdown' }
        );
    });

    // Handle wallet address input
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';

        // Check if user is waiting for wallet address to track
        if (usersWaitingForWallet.get(chatId)) {
            // Remove waiting state
            usersWaitingForWallet.delete(chatId);

            // Basic Solana address validation (44 characters, base58)
            if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(text)) {
                await bot.sendMessage(
                    chatId,
                    '❌ Invalid Solana wallet address. Please provide a valid 44-character base58 address.\n\n' +
                    'Use /track_wallet to try again.'
                );
                return;
            }

            try {
                await addTrackedWallet(db, chatId, text);
                await bot.sendMessage(
                    chatId,
                    `✅ Now tracking wallet \`${text}\` for new transfers. You'll get alerts here.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Error in wallet tracking:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error tracking wallet: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    'Use /track_wallet to try again.'
                );
            }
        }

        // Check if user is waiting to remove wallet
        if (usersWaitingToRemoveWallet.get(chatId)) {
            // Remove waiting state
            usersWaitingToRemoveWallet.delete(chatId);

            // Basic Solana address validation (44 characters, base58)
            if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(text)) {
                await bot.sendMessage(
                    chatId,
                    '❌ Invalid Solana wallet address. Please provide a valid 44-character base58 address.\n\n' +
                    'Use /remove_wallet to try again.'
                );
                return;
            }

            try {
                await removeTrackedWallet(db, chatId, text);
                await bot.sendMessage(
                    chatId,
                    `✅ Stopped tracking wallet \`${text}\`.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Error in wallet removal:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error removing wallet: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    'Use /remove_wallet to try again.'
                );
            }
        }

        // Check if user is waiting for token input
        if (usersWaitingForToken.get(chatId)) {
            // Remove waiting state
            usersWaitingForToken.delete(chatId);

            // Send immediate feedback that we're processing
            await bot.sendMessage(
                chatId,
                `🔍 Processing your request for token "${text}"...`,
                { parse_mode: 'Markdown' }
            );

            try {
                // Check if user has reached their subscription limit
                const currentCount = await getTokenSubscriptionCount(db, chatId);
                if (currentCount >= PRICE_ALERT_CONFIG.maxAlertsPerUser) {
                    await bot.sendMessage(
                        chatId,
                        `❌ You've reached the maximum limit of ${PRICE_ALERT_CONFIG.maxAlertsPerUser} tracked tokens. ` +
                        `Please remove some before adding more.\n\n` +
                        `Use /my_alerts to view your current alerts.`
                    );
                    return;
                }

                // Get token details from input (could be symbol or address)
                const token = await getTokenBySymbolOrAddress(text);

                if (!token) {
                    await bot.sendMessage(
                        chatId,
                        `❌ Token "${text}" not found. Please provide a valid token symbol or address.\n\n` +
                        `Use /track_token to try again with a different token.`
                    );
                    return;
                }

                // Subscribe user to this token's alerts
                await subscribeToTokenAlerts(db, chatId, token.mint_address);

                // Get 24h price change for context
                const priceChange24h = await getTokenPriceChange(db, token.mint_address, 24);
                const changeText = priceChange24h ?
                    `(${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}% in 24h)` : '';

                await bot.sendMessage(
                    chatId,
                    `✅ Successfully set up tracking for <b>${token.name} (${token.symbol})</b>!\n\n` +
                    `💰 Current price: $${token.current_price.toFixed(4)} ${changeText}\n\n` +
                    `You'll receive alerts when price moves significantly (±${PRICE_ALERT_CONFIG.generalAlertThresholdPercent}%).\n\n` +
                    `To set specific price targets, use:\n` +
                    `/set_alert ${token.symbol} <code>target_price</code>`,
                    { parse_mode: 'HTML' }
                );

                // Send a test alert if this is their first token
                if (currentCount === 0) {
                    // Wait a bit before sending test alert
                    setTimeout(async () => {
                        await sendTestPriceAlerts(chatId, token);
                    }, 3000);
                }
            } catch (error) {
                console.error('Error in /track_token command:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error tracking token: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    `Use /track_token to try again.`
                );
            }
        }

        // Check if user is waiting for alert token input
        if (usersWaitingForAlertToken.get(chatId)) {
            // Remove waiting state
            usersWaitingForAlertToken.delete(chatId);

            // Send immediate feedback that we're processing
            await bot.sendMessage(
                chatId,
                `🔍 Processing your request for token "${text}"...`,
                { parse_mode: 'Markdown' }
            );

            try {
                // Get token details from input (could be symbol or address)
                const token = await getTokenBySymbolOrAddress(text);

                if (!token) {
                    await bot.sendMessage(
                        chatId,
                        `❌ Token "${text}" not found. Please provide a valid token symbol or address.\n\n` +
                        `Use /set_alert to try again with a different token.`
                    );
                    return;
                }

                // Store the token and ask for price
                usersWaitingForAlertPrice.set(chatId, { token: text });
                await bot.sendMessage(
                    chatId,
                    `✅ Found token: <b>${token.name} (${token.symbol})</b>\n\n` +
                    `💰 Current price: $${token.current_price.toFixed(4)}\n\n` +
                    `Please enter your target price for the alert.`,
                    { parse_mode: 'HTML' }
                );

                // Critical fix: Return here to prevent continuing to the price check in the same function call
                return;
            } catch (error) {
                console.error('Error in /set_alert command:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error processing token: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    `Use /set_alert to try again.`
                );
                return;
            }
        }

        // Check if user is waiting for alert price input
        if (usersWaitingForAlertPrice.has(chatId)) {
            const tokenInfo = usersWaitingForAlertPrice.get(chatId);
            if (!tokenInfo) return;

            // Remove waiting state only if a valid price is entered
            // (so we can keep prompting if the input is invalid)

            // Send immediate feedback that we're processing
            await bot.sendMessage(
                chatId,
                `🔍 Processing your target price "${text}"...`,
                { parse_mode: 'Markdown' }
            );

            // Check if input is a valid number
            const targetPrice = parseFloat(text);
            if (isNaN(targetPrice) || targetPrice <= 0) {
                await bot.sendMessage(
                    chatId,
                    `❌ That doesn't look like a valid number. Please enter a valid price for <b>${tokenInfo.token.toUpperCase()}</b> (e.g., 100), or type /cancel to start over.`,
                    { parse_mode: 'HTML' }
                );
                // Do NOT remove the user from usersWaitingForAlertPrice, so they can try again
                return;
            }

            // Remove waiting state only after a valid price
            usersWaitingForAlertPrice.delete(chatId);

            try {
                // Get token details again
                const token = await getTokenBySymbolOrAddress(tokenInfo.token);
                if (!token) {
                    await bot.sendMessage(
                        chatId,
                        `❌ Token "${tokenInfo.token}" not found. Please try again.\n\n` +
                        `Use /set_alert to start over.`
                    );
                    return;
                }

                // Check if user has reached their alert limit
                const currentAlerts = await getUserPriceAlerts(db, chatId);
                if (currentAlerts.length >= PRICE_ALERT_CONFIG.maxAlertsPerUser) {
                    await bot.sendMessage(
                        chatId,
                        `❌ You've reached the maximum limit of ${PRICE_ALERT_CONFIG.maxAlertsPerUser} price alerts. ` +
                        `Please remove some with /remove_alert before adding more.`
                    );
                    return;
                }

                // Determine if this is a price rise or fall alert
                const isAboveTarget = targetPrice > token.current_price;

                // Validate if target makes sense
                const errorMessage = validatePriceTarget(token, targetPrice);
                if (errorMessage) {
                    await bot.sendMessage(chatId, errorMessage + '\n\nUse /set_alert to try again.', { parse_mode: 'HTML' });
                    return;
                }

                // Create the price alert
                const alertId = await createPriceAlert(
                    db,
                    chatId,
                    token.mint_address,
                    targetPrice,
                    isAboveTarget
                );

                if (!alertId) {
                    throw new Error('Failed to create price alert');
                }

                // Ensure user is also subscribed to general alerts for this token
                await subscribeToTokenAlerts(db, chatId, token.mint_address);

                // Get recent price change to estimate time to target
                const recentChange = await getTokenPriceChange(db, token.mint_address, 1); // 1 hour change
                let timeEstimate = '';

                if (recentChange && recentChange !== 0) {
                    const hours = estimateTimeToTarget(token.current_price, targetPrice, recentChange);
                    if (hours !== null) {
                        timeEstimate = `\n\nBased on recent movements, your target might be reached in ${formatTimeEstimate(hours)}.`;
                    }
                }

                // Price movement direction
                const priceMovement = isAboveTarget
                    ? `rises to $${targetPrice.toFixed(4)}`
                    : `falls to $${targetPrice.toFixed(4)}`;

                await bot.sendMessage(
                    chatId,
                    `✅ Price alert set for <b>${token.symbol}</b>!\n\n` +
                    `You'll be notified when the price ${priceMovement}.\n` +
                    `Current price: $${token.current_price.toFixed(4)}\n` +
                    `Target price: $${targetPrice.toFixed(4)}` +
                    timeEstimate +
                    `\n\nYou can view your alerts with /my_alerts`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error('Error in /set_alert command:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error setting price alert: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    `Use /set_alert to try again.`
                );
            }
        }

        // Check if user is waiting to remove an alert
        if (usersWaitingToRemoveAlert.get(chatId)) {
            // Remove waiting state
            usersWaitingToRemoveAlert.delete(chatId);

            // Send immediate feedback that we're processing
            await bot.sendMessage(
                chatId,
                `🔍 Processing your request to remove alert #${text}...`
            );

            try {
                // Parse the alert ID
                const alertId = parseInt(text.trim());

                if (isNaN(alertId)) {
                    await bot.sendMessage(
                        chatId,
                        '❌ Please provide a valid alert ID number.\n\n' +
                        'Use /remove_alert to try again.'
                    );
                    return;
                }

                const removed = await removePriceAlert(db, chatId, alertId);

                if (removed) {
                    await bot.sendMessage(chatId, `✅ Successfully removed price alert #${alertId}.`);
                } else {
                    await bot.sendMessage(
                        chatId,
                        `❌ Could not find alert #${alertId} or you don't have permission to remove it.\n\n` +
                        'Use /my_alerts to view your active alerts and verify the ID.'
                    );
                }
            } catch (error) {
                console.error('Error in /remove_alert command:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error removing alert: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    'Use /remove_alert to try again.'
                );
            }

            return;
        }
    });

    // Handle /my_wallets command
    bot.onText(/\/my_wallets/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const wallets = await getUserTrackedWallets(db, chatId);

            if (wallets.length === 0) {
                await bot.sendMessage(chatId, "You're not tracking any wallets yet. Use /track_wallet to start tracking a wallet.");
                return;
            }

            let message = `🔍 <b>Your Tracked Wallets (${wallets.length}/5)</b>\n\n`;

            wallets.forEach((wallet: { wallet_address: string; tracking_started_at: number | null; label?: string }, index: number) => {
                const startDate = wallet.tracking_started_at ?
                    new Date(wallet.tracking_started_at * 1000).toISOString().split('T')[0] :
                    'Unknown';

                message += `${index + 1}. <code>${wallet.wallet_address}</code>\n`;
                message += `   Tracking since: ${startDate}\n`;
                if (wallet.label) {
                    message += `   Label: ${wallet.label}\n`;
                }
                message += '\n';
            });

            message += "To stop tracking a wallet, use /remove_wallet";

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            console.error('Error in /my_wallets command:', error);
            await bot.sendMessage(chatId, `❌ Error fetching your wallets: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Handle /track_token command
    bot.onText(/\/track_token/, async (msg) => {
        const chatId = msg.chat.id;
        // Set user as waiting for token input
        usersWaitingForToken.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the token symbol or address you want to track.\n\n', { parse_mode: 'Markdown' });
    });

    // Handle /set_alert command
    bot.onText(/\/set_alert/, async (msg) => {
        const chatId = msg.chat.id;
        // Set user as waiting for token input
        usersWaitingForAlertToken.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the token symbol or address for your price alert.\n\n', { parse_mode: 'Markdown' });
    });

    // Handle /my_alerts command
    bot.onText(/\/my_alerts/, async (msg) => {
        const chatId = msg.chat.id;

        try {
            // Get user's token subscriptions
            const subscriptions = await getUserTokenSubscriptions(db, chatId);
            const priceAlerts = await getUserPriceAlerts(db, chatId);

            if (subscriptions.length === 0 && priceAlerts.length === 0) {
                await bot.sendMessage(
                    chatId,
                    "You don't have any active token alerts. Use /track_token to start tracking a token's price movements."
                );
                return;
            }

            let message = `📊 <b>Your Token Alerts</b>\n\n`;

            // General price movement alerts
            if (subscriptions.length > 0) {
                message += `<b>General Price Movements (±${PRICE_ALERT_CONFIG.generalAlertThresholdPercent}%):</b>\n`;

                for (const sub of subscriptions) {
                    // Get 24h change for context
                    const change24h = await getTokenPriceChange(db, sub.mint_address, 24);
                    const changeText = change24h !== null
                        ? `(${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% 24h)`
                        : '';

                    // Check if price is available
                    const currentPrice = sub.current_price !== null && sub.current_price !== undefined
                        ? `$${sub.current_price.toFixed(4)}`
                        : 'Price unavailable';

                    message += `• ${sub.symbol}: ${currentPrice} ${changeText}\n`;
                }

                message += `\n`;
            }

            // Specific price target alerts
            if (priceAlerts.length > 0) {
                message += `<b>Price Target Alerts:</b>\n`;

                for (const alert of priceAlerts) {
                    // Get token info for display
                    const tokenInfo = await getTokenPrice(db, alert.mint_address);
                    if (!tokenInfo) continue;

                    // Handle current price safely
                    const currentPrice = tokenInfo.current_price !== null && tokenInfo.current_price !== undefined
                        ? tokenInfo.current_price
                        : 0;

                    // Calculate % to target
                    const pctToTarget = ((alert.target_price - currentPrice) / (currentPrice || 1) * 100).toFixed(2);
                    const direction = alert.is_above_target ? '🔼' : '🔽';

                    message += `• ID ${alert.id}: ${tokenInfo.symbol} ${direction} $${alert.target_price.toFixed(4)}\n`;
                    message += `  Current: ${currentPrice > 0 ? `$${currentPrice.toFixed(4)}` : 'Price unavailable'} (${pctToTarget}% to target)\n`;
                }
            }

            message += `\nTo remove a specific price target alert, use /remove_alert <code>id</code>`;

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            console.error('Error in /my_alerts command:', error);
            await bot.sendMessage(
                chatId,
                `❌ Error fetching your alerts: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    });

    // Handle /remove_alert command
    bot.onText(/\/remove_alert/, async (msg) => {
        const chatId = msg.chat.id;
        // Set user as waiting for alert ID
        usersWaitingToRemoveAlert.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the ID of the alert you want to remove.\n\nYou can view your alerts with /my_alerts');
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