import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getRankedDexData, formatDigestMessage, getTokenBySymbolOrAddress, getActiveKOLAccounts, type KOLAccountWithPnL, getKOLAccounts, type KnownAccount } from './vybeApi';
import {
    addTrackedWallet,
    getUserTrackedWallets,
    removeTrackedWallet,
    createPriceAlert,
    getUserPriceAlerts,
    removePriceAlert,
    getTokenPrice,
    addKolUnsubscription,
    getAllUserIds,
    getKolUnsubscribedUserIds,
} from './database';
import { getTokenPriceChange } from './tokenPriceService';
import { PRICE_ALERT_CONFIG } from './config';
import { estimateTimeToTarget, formatTimeEstimate, validatePriceTarget } from './tokenAlerts';
import { generatePriceBoardImage } from './utils/imageGenerator';
import { appEvents, EVENT_TRACKED_WALLETS_CHANGED } from './appEvents';
import { VybeTransfer } from './vybeApi';

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
// const usersWaitingForToken = new Map<number, boolean>(); // Removed
// Map to track users waiting for alert token and price
const usersWaitingForAlertToken = new Map<number, boolean>();
const usersWaitingForAlertPrice = new Map<number, { token: string }>();
// Map to track users waiting for alert ID to remove
const usersWaitingToRemoveAlert = new Map<number, boolean>();

// Add KOL pagination state tracking
const kolsPageState = new Map<number, number>();  // chatId -> current page
const KOLS_PER_PAGE = 5;

// Map to store last viewed KOL per user for /track_kol context
const lastViewedKOL = new Map<number, KOLAccountWithPnL>();

// Move the truncateAddress helper function here so it is defined before use
function truncateAddress(address: string, startChars = 6, endChars = 4): string {
    if (address.length <= startChars + endChars + 3) {
        return address; // Address is too short to truncate meaningfully
    }
    return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

// Set up the commands that will appear in the menu
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and see available commands' },
    { command: 'kols', description: 'View top KOL traders and their performance' },
    // { command: 'track_token', description: 'Track a token for price alerts' }, // Removed
    { command: 'set_alert', description: 'Set price target alert for a token' },
    { command: 'my_alerts', description: 'View your active price alerts' },
    { command: 'remove_alert', description: 'Remove a specific price alert' },
]).then(() => {
    // console.log('Bot commands menu set successfully');
}).catch((error) => {
    // console.error('Error setting bot commands:', error);
});

// Replace startBot function with setupBot that accepts db parameter
export function setupBot(db: any) {
    // Only start polling if not already polling
    if (!isPolling) {
        bot.startPolling().then(() => {
            isPolling = true;
            // console.log('Bot polling started successfully');
        }).catch((error) => {
            // console.error('Error starting bot polling:', error);
            // If it's a conflict error, try to stop polling first
            if (error.response?.body?.error_code === 409) {
                // console.log('Bot already polling, attempting to stop and restart...');
                bot.stopPolling().then(() => {
                    bot.startPolling().then(() => {
                        isPolling = true;
                        // console.log('Bot polling restarted successfully');
                    });
                });
            }
        });
    }

    // Handle /start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        // console.log('Received /start command from chatId:', chatId);

        // Send the welcome image
        await bot.sendPhoto(chatId, 'assets/welcome_2.png', {
            caption: `🚀 <b>Welcome to bs_vybe Bot!</b>\n\n` +

                `<b>🏆 KOL TRACKING</b>\n` +
                `/kols - View top traders & their performance\n` +
                `➕ Use /track_kol after viewing a KOL to track their wallet\n` +
                `🔔 Get updates on Top KOL ranking changes!\n\n` +

                `<b>💰 PRICE ALERTS</b>\n` +
                // `/track_token - Get alerts for price movements\n` + // Removed
                `/set_alert - Set target price alerts\n` +
                `/my_alerts - View your active alerts\n` +
                `/remove_alert id - Remove an alert\n\n`,
            parse_mode: 'HTML'
        });
    });

    // Add a /help command that shows the same information as /start
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId,
            `🚀 <b>Welcome to the Vybe Bot!</b> 🚀\n\n` +

            `<b>📱 WALLET TRACKING</b>\n` +
            `/tracked_wallets - View your tracked wallets\n` +
            `/remove_wallet - Stop tracking a wallet\n\n` +

            `<b>💰 TOKEN PRICE ALERTS</b>\n` +
            `/set_alert <code>symbol/address</code> <code>targetPrice</code> - Get notified when price reaches target\n` +
            `  Example: /set_alert SOL 100 or /set_alert BONK 0.00001\n\n` +

            `/my_alerts - View your active price alerts\n` +
            `/remove_alert <code>id</code> - Remove a specific price alert\n\n` +

            `<b>🏆 KOL TRACKING</b>\n` +
            `/kols - View top KOL traders and their performance\n` +
            `  ➕ Use /track_kol (after /kols) to track a KOL's wallet\n` +
            `🔔 Get periodic updates on Top KOL ranking changes!
` +
            `  /unsubscribe_kol_updates - Opt-out of KOL updates\n
` +

            `<b>ℹ️ OTHER COMMANDS</b>\n` +
            `/help - Show this message again\n\n` +

            `<b>🔔 ABOUT PRICE ALERTS:</b>\n` +
            `• Price target alerts trigger when a token crosses your specified price\n` +
            `• You can set up to ${PRICE_ALERT_CONFIG.maxAlertsPerUser} price alerts`,
            { parse_mode: 'HTML' }
        );
    });

    // Handle /tracked_wallets command
    bot.onText(/\/tracked_wallets/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const [userWallets, kolAccounts] = await Promise.all([
                getUserTrackedWallets(db, chatId),
                getKOLAccounts()
            ]);
            if (userWallets.length === 0) {
                await bot.sendMessage(chatId, "You're not tracking any wallets yet. Use /track_kol after viewing a KOL profile to start.");
                return;
            }
            const kolLookup = new Map<string, { name: string; twitterUrl?: string }>();
            if (kolAccounts) {
                kolAccounts.forEach(kol => {
                    kolLookup.set(kol.ownerAddress, { name: kol.name, twitterUrl: kol.twitterUrl });
                });
            }
            const kolWallets: any[] = [];
            const otherWallets: any[] = [];
            userWallets.forEach((wallet: { wallet_address: string; tracking_started_at: number | null; label?: string }) => {
                const kolInfo = kolLookup.get(wallet.wallet_address);
                if (kolInfo) {
                    kolWallets.push({ ...wallet, kolName: kolInfo.name, twitterUrl: kolInfo.twitterUrl });
                } else {
                    otherWallets.push(wallet);
                }
            });
            let message = `📊 <b>Your Tracked Wallets (${userWallets.length}/5)</b>\n`;
            let listIndex = 1;
            // Display KOL Wallets
            if (kolWallets.length > 0) {
                message += `\n<b>👑 KOL Wallets:</b>\n`;
                kolWallets.forEach(wallet => {
                    const startDate = wallet.tracking_started_at ? new Date(wallet.tracking_started_at * 1000).toISOString().split('T')[0] : 'Unknown';
                    const truncatedAddr = truncateAddress(wallet.wallet_address);
                    const explorerUrl = `https://vybe.fyi/wallets/${wallet.wallet_address}?tab=trading`;
                    let twitterHandle = '';
                    if (wallet.twitterUrl) {
                        const match = wallet.twitterUrl.match(/twitter\.com\/(\w+)|x\.com\/(\w+)/);
                        if (match && (match[1] || match[2])) {
                            twitterHandle = ` (@${match[1] || match[2]})`;
                        }
                    }
                    message += `${listIndex}. <b>${wallet.kolName}</b>${twitterHandle}\n`;
                    message += `   <code>${wallet.wallet_address}</code>\n`;
                    message += `   <a href=\"${explorerUrl}\">View on Vybe</a>\n`;
                    message += `   Tracked since: ${startDate}\n\n`;
                    listIndex++;
                });
            }
            // Display Other Wallets
            if (otherWallets.length > 0) {
                message += `\n<b>👤 Other Wallets:</b>\n`;
                otherWallets.forEach(wallet => {
                    const startDate = wallet.tracking_started_at ? new Date(wallet.tracking_started_at * 1000).toISOString().split('T')[0] : 'Unknown';

                    const explorerUrl = `https://vybe.fyi/wallets/${wallet.wallet_address}?tab=trading`;
                    message += `${listIndex}. <code>${wallet.wallet_address}</code>\n`;
                    message += `   <a href=\"${explorerUrl}\">View on Vybe</a>\n`;
                    message += `   Tracked since: ${startDate}\n`;
                    if (wallet.label) {
                        message += `   Label: ${wallet.label}\n`;
                    }
                    message += '\n';
                    listIndex++;
                });
            }
            message += "\n• Use /remove_wallet to stop tracking.\n";
            message += "• Use /track_kol after viewing a KOL profile to add more.";
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
        } catch (error) {
            // console.error('Error in /tracked_wallets command:', error);
            await bot.sendMessage(chatId, `❌ Error fetching your wallets: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
                // Emit event after successful add
                appEvents.emit(EVENT_TRACKED_WALLETS_CHANGED);
                await bot.sendMessage(
                    chatId,
                    `✅ Now tracking wallet \`${text}\` for new transfers. You'll get alerts here.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                // console.error('Error in wallet tracking:', error);
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
                const removed = await removeTrackedWallet(db, chatId, text);
                if (removed) {
                    // Emit event after successful removal
                    appEvents.emit(EVENT_TRACKED_WALLETS_CHANGED);
                    await bot.sendMessage(
                        chatId,
                        `✅ Stopped tracking wallet \`${text}\`.`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    // Handle case where wallet wasn't found or couldn't be removed
                    await bot.sendMessage(
                        chatId,
                        `❌ Wallet \`${text}\` was not found in your tracked list.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (error) {
                // console.error('Error in wallet removal:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error removing wallet: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    'Use /remove_wallet to try again.'
                );
            }
        }

        // Check if user is waiting for token input (Removed)
        /*
        if (usersWaitingForToken.get(chatId)) {
            // Entire block removed or commented out
        }
        */

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
                    `💰 Current price: $${token.current_price.toFixed(7)}\n\n` +
                    `Please enter your target price for the alert.`,
                    { parse_mode: 'HTML' }
                );

                // Critical fix: Return here to prevent continuing to the price check in the same function call
                return;
            } catch (error) {
                // console.error('Error in /set_alert command:', error);
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
                    `Current price: $${token.current_price.toFixed(7)}\n` +
                    `Target price: $${targetPrice.toFixed(4)}` +
                    timeEstimate +
                    `\n\nYou can view your alerts with /my_alerts`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                // console.error('Error in /set_alert command:', error);
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
                // console.error('Error in /remove_alert command:', error);
                await bot.sendMessage(
                    chatId,
                    `❌ Error removing alert: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                    'Use /remove_alert to try again.'
                );
            }

            return;
        }
    });

    // Handle /track_token command (Removed)
    /*
    bot.onText(/\/track_token/, async (msg) => {
        const chatId = msg.chat.id;
        usersWaitingForToken.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the token symbol or address you want to track.\n\n', { parse_mode: 'Markdown' });
    });
    */

    // Handle /set_alert command
    bot.onText(/\/set_alert/, async (msg) => {
        const chatId = msg.chat.id;
        usersWaitingForAlertToken.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the token symbol or address for your price alert.\n\n', { parse_mode: 'Markdown' });
    });

    // Handle /my_alerts command
    bot.onText(/\/my_alerts/, async (msg) => {
        const chatId = msg.chat.id;

        try {
            const priceAlerts = await getUserPriceAlerts(db, chatId);

            if (priceAlerts.length === 0) {
                await bot.sendMessage(
                    chatId,
                    "You don't have any active price target alerts. Use /set_alert to create one."
                );
                return;
            }

            let message = `📊 <b>Your Token Alerts</b>\n\n`;

            // Removed the section for General Price Movements based on subscriptions
            /*
            if (subscriptions.length > 0) {
                 // Block removed or commented out
            }
            */

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
            // console.error('Error in /my_alerts command:', error);
            await bot.sendMessage(
                chatId,
                `❌ Error fetching your alerts: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    });

    // Handle /remove_alert command
    bot.onText(/\/remove_alert/, async (msg) => {
        const chatId = msg.chat.id;
        usersWaitingToRemoveAlert.set(chatId, true);
        await bot.sendMessage(chatId, '🔍 Please enter the ID of the alert you want to remove.\n\nYou can view your alerts with /my_alerts');
    });

    // Update the /kols command handler
    bot.onText(/\/kols/, async (msg) => {
        const chatId = msg.chat.id;
        // console.log('Received /kols command from chatId:', chatId);

        try {
            // Show loading state
            const loadingMessageId = await showLoadingState(chatId);
            kolsPageState.set(chatId, 1);

            // Get active KOLs data with timeout
            const activeKOLs = await Promise.race([
                getActiveKOLAccounts(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timeout')), 15000)
                )
            ]) as KOLAccountWithPnL[] | null;

            // Delete loading message
            await bot.deleteMessage(chatId, loadingMessageId);

            if (!activeKOLs || activeKOLs.length === 0) {
                await bot.sendMessage(chatId,
                    '❌ <b>No Active KOL Data Available</b>\n\n' +
                    'Unable to fetch KOL trading data at the moment.\n' +
                    'This might be due to:\n' +
                    '• API service maintenance\n' +
                    '• Network connectivity issues\n' +
                    '• No active traders in the timeframe\n\n' +
                    'Please try again in a few minutes.',
                    { parse_mode: 'HTML' }
                );
                return;
            }

            // Sort KOLs by trading volume
            const sortedKOLs = activeKOLs.sort((a, b) =>
                b.pnlData.summary.tradesVolumeUsd - a.pnlData.summary.tradesVolumeUsd
            );

            // Calculate total pages
            const totalPages = Math.ceil(sortedKOLs.length / KOLS_PER_PAGE);

            // Format message and create keyboard
            const message = formatKOLsList(sortedKOLs, 1, totalPages);
            const keyboard = createKOLsPaginationKeyboard(1, totalPages);

            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (error) {
            // console.error('Error in /kols command:', error);

            // Enhanced error message based on error type
            let errorMessage = '❌ <b>Error Fetching KOL Data</b>\n\n';

            if (error instanceof Error) {
                if (error.message === 'Request timeout') {
                    errorMessage += 'Request timed out. The server is taking too long to respond.\n';
                } else {
                    errorMessage += `Error: ${error.message}\n`;
                }
            }

            errorMessage += '\nPlease try again in a few moments.';

            await bot.sendMessage(chatId, errorMessage, { parse_mode: 'HTML' });
        }
    });

    // Handle pagination callback queries
    bot.on('callback_query', async (query) => {
        if (!query.message || !query.data) return;

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        // Handle KOLs pagination
        if (query.data.startsWith('kols_page_')) {
            try {
                const newPage = parseInt(query.data.split('_')[2]);

                // Show loading indicator
                await bot.answerCallbackQuery(query.id, {
                    text: '📊 Loading new page...'
                });

                // Get active KOLs data
                const activeKOLs = await getActiveKOLAccounts();

                if (!activeKOLs || activeKOLs.length === 0) {
                    await bot.answerCallbackQuery(query.id, {
                        text: '❌ No KOL data available',
                        show_alert: true
                    });
                    return;
                }

                // Sort KOLs by trading volume
                const sortedKOLs = activeKOLs.sort((a, b) =>
                    b.pnlData.summary.tradesVolumeUsd - a.pnlData.summary.tradesVolumeUsd
                );

                // Calculate total pages
                const totalPages = Math.ceil(sortedKOLs.length / KOLS_PER_PAGE);

                // Validate page number
                if (newPage < 1 || newPage > totalPages) {
                    await bot.answerCallbackQuery(query.id, {
                        text: '❌ Invalid page number',
                        show_alert: true
                    });
                    return;
                }

                // Update page state
                kolsPageState.set(chatId, newPage);

                // Update message with new page
                const message = formatKOLsList(sortedKOLs, newPage, totalPages);
                const keyboard = createKOLsPaginationKeyboard(newPage, totalPages);

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });

            } catch (error) {
                // console.error('Error handling KOLs pagination:', error);
                await bot.answerCallbackQuery(query.id, {
                    text: '❌ Error updating page. Please try /kols again.',
                    show_alert: true
                });
            }
        }
    });

    // Add KOL detail view handler
    bot.onText(/^\/(\d+)$/, async (msg, match) => {
        if (!match) return; // Handle null match case
        const chatId = msg.chat.id;
        const kolNumber = parseInt(match[1]);
        try {
            const loadingMessageId = await showLoadingState(chatId);
            const activeKOLs = await getActiveKOLAccounts();
            await bot.deleteMessage(chatId, loadingMessageId);
            if (!activeKOLs || activeKOLs.length === 0) {
                await bot.sendMessage(chatId, '❌ <b>No KOL Data Available</b>\n\nUnable to fetch KOL trading data at the moment.\nPlease try again in a few minutes.', { parse_mode: 'HTML' });
                return;
            }
            const sortedKOLs = activeKOLs.sort((a, b) => b.pnlData.summary.tradesVolumeUsd - a.pnlData.summary.tradesVolumeUsd);
            if (kolNumber < 1 || kolNumber > sortedKOLs.length) {
                await bot.sendMessage(chatId, `❌ <b>Invalid KOL Number</b>\n\nPlease select a number between 1 and ${sortedKOLs.length}.\nUse /kols to see the list of available KOLs.`, { parse_mode: 'HTML' });
                return;
            }
            const kol = sortedKOLs[kolNumber - 1];
            // Store context for /track_kol
            lastViewedKOL.set(chatId, kol);
            const message = formatKOLDetailView(kol, kolNumber);
            const keyboard = createKOLDetailKeyboard(kolNumber, kol.twitterUrl);
            if (kol.logoUrl) {
                await bot.sendPhoto(chatId, kol.logoUrl, { caption: message, parse_mode: 'HTML', reply_markup: keyboard });
            } else {
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
            }
        } catch (error) {
            // console.error('Error in KOL detail view:', error);
            await bot.sendMessage(chatId, '❌ <b>Error Loading KOL Details</b>\n\nUnable to fetch detailed information at the moment.\nPlease try again in a few minutes.', { parse_mode: 'HTML' });
        }
    });

    // /track_kol command handler
    bot.onText(/\/track_kol/, async (msg) => {
        const chatId = msg.chat.id;
        const kol = lastViewedKOL.get(chatId);
        if (!kol) {
            await bot.sendMessage(chatId, '❌ Please view a KOL\'s details first using /kols, then use /track_kol to track their wallet.');
            return;
        }
        try {
            // Validate wallet address
            const walletAddress = kol.ownerAddress;
            if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(walletAddress)) {
                await bot.sendMessage(chatId, '❌ This KOL\'s wallet address is invalid or missing.');
                return;
            }
            // Try to add the wallet
            await addTrackedWallet(db, chatId, walletAddress);
            // Emit event after successful add
            appEvents.emit(EVENT_TRACKED_WALLETS_CHANGED);
            await bot.sendMessage(chatId,
                `✅ Now tracking <b>${kol.name}</b>'s wallet for new trades!\n You will receive alerts when they trade a new token.\n View all your tracked wallets with /tracked_wallets.`,
                { parse_mode: 'HTML' });
            // Optionally clear context after success
            lastViewedKOL.delete(chatId);
        } catch (error: any) {
            let errorMsg = '❌ Error tracking this KOL\'s wallet.';
            if (error instanceof Error && error.message) {
                if (error.message.includes('maximum limit')) {
                    errorMsg = `❌ You\'ve reached the maximum limit of tracked wallets. Remove one with /remove_wallet before adding more.`;
                } else if (error.message.includes('UNIQUE constraint failed')) {
                    errorMsg = `❌ You are already tracking <b>${kol.name}</b>'s wallet.`;
                } else {
                    errorMsg = `❌ ${error.message}`;
                }
            }
            await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        }
    });

    // Handle /unsubscribe_kol_updates command
    bot.onText(/\/unsubscribe_kol_updates/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            await addKolUnsubscription(db, chatId);
            await bot.sendMessage(chatId, "❌ You will no longer receive Top KOL updates.");
        } catch (error) {
            // console.error('Error unsubscribing user from KOL updates:', error);
            await bot.sendMessage(chatId, "❌ An error occurred while trying to unsubscribe.");
        }
    });

    // Error handling
    bot.on('error', (error) => {
        // console.error('Telegram bot error:', error);
    });
    bot.on('polling_error', (error) => {
        // console.error('Telegram bot polling error:', error);
    });

    // console.log(`Bot started... Now listening for commands.`);
}

// Export the bot instance
export { bot };

// Helper function to format large numbers
function formatNumber(num: number): string {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toFixed(0);
}

// Helper function to format PnL with color indicator
function formatPnL(pnl: number): string {
    const prefix = pnl >= 0 ? '+' : '';
    return `${prefix}$${formatNumber(pnl)}`;
}

// Add pagination keyboard creator
function createKOLsPaginationKeyboard(currentPage: number, totalPages: number): TelegramBot.InlineKeyboardMarkup {
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    const row: TelegramBot.InlineKeyboardButton[] = [];

    if (currentPage > 1) {
        row.push({
            text: '⬅️ Previous',
            callback_data: `kols_page_${currentPage - 1}`
        });
    }

    if (currentPage < totalPages) {
        row.push({
            text: 'Next ➡️',
            callback_data: `kols_page_${currentPage + 1}`
        });
    }

    if (row.length > 0) {
        buttons.push(row);
    }

    return {
        inline_keyboard: buttons
    };
}

// Update KOLs list formatting to remove logo emoji before name
function formatKOLsList(kols: KOLAccountWithPnL[], page: number, totalPages: number): string {
    const start = (page - 1) * KOLS_PER_PAGE;
    const pageKols = kols.slice(start, start + KOLS_PER_PAGE);

    let message = `🏆 <b>Top KOL Traders</b> | Page ${page}/${totalPages}\n\n`;

    pageKols.forEach((kol, index) => {
        const pnl = kol.pnlData.summary.realizedPnlUsd;
        const winRate = (kol.pnlData.summary.winRate * 100).toFixed(1);
        const volume = kol.pnlData.summary.tradesVolumeUsd;
        const trades = kol.pnlData.summary.tradesCount;
        const uniqueTokens = kol.pnlData.summary.uniqueTokensTraded;
        const performanceEmoji = pnl >= 0 ? '🟢' : '🔴';
        const winRateEmoji = parseFloat(winRate) >= 50 ? '✅' : '⚠️';
        const bestToken = kol.pnlData.summary.bestPerformingToken;
        const worstToken = kol.pnlData.summary.worstPerformingToken;
        // Only show the KOL name, no emoji or logo before it
        message += `${performanceEmoji} /${start + index + 1} <b>${kol.name}</b>\n`;
        message += `💰 Volume: $${formatNumber(volume)} | ${winRateEmoji} Win Rate: ${winRate}%\n`;
        message += `📊 PnL: ${formatPnL(pnl)} | 🎯 Trades: ${trades} | 🔄 Tokens: ${uniqueTokens}\n`;
        if (bestToken) {
            message += `⭐️ Best: ${bestToken.tokenSymbol} (${formatPnL(bestToken.pnlUsd)})\n`;
        }
        if (worstToken) {
            message += `📉 Worst: ${worstToken.tokenSymbol} (${formatPnL(worstToken.pnlUsd)})\n`;
        }
        message += '\n';
    });

    message += '💡 <b>Click on the numbers</b> (e.g., /1, /2) to see detailed trading history\n';
    message += '📊 Sorted by trading volume | Updated in real-time';
    return message;
}

// Enhanced loading states
async function showLoadingState(chatId: number): Promise<number> {
    const loadingMessage = await bot.sendMessage(chatId,
        '🔄 <b>Loading KOL Data</b>\n\n' +
        '⏳ Fetching trader information...\n' +
        '📊 Calculating performance metrics...\n' +
        '💫 Preparing display...',
        { parse_mode: 'HTML' }
    );
    return loadingMessage.message_id;
}

// Trimmed KOL detail view for better UX
function formatKOLDetailView(kol: KOLAccountWithPnL, kolNumber: number): string {
    const summary = kol.pnlData.summary;
    let message = `👤 <b>${kol.name}</b> | KOL #${kolNumber}\n\n`;
    message += `📊 <b>Performance</b>\n`;
    message += `PnL: ${formatPnL(summary.realizedPnlUsd)} | Win: ${(summary.winRate * 100).toFixed(1)}% | Trades: ${summary.tradesCount} | Vol: $${formatNumber(summary.tradesVolumeUsd)}\n\n`;
    if (summary.bestPerformingToken && summary.worstPerformingToken && summary.bestPerformingToken.tokenSymbol === summary.worstPerformingToken.tokenSymbol) {
        message += `⭐️ <b>Best/Worst Token</b>: ${summary.bestPerformingToken.tokenSymbol} (${formatPnL(summary.bestPerformingToken.pnlUsd)}/${formatPnL(summary.worstPerformingToken.pnlUsd)})\n\n`;
    } else {
        if (summary.bestPerformingToken) {
            message += `⭐️ <b>Best Token</b>: ${summary.bestPerformingToken.tokenSymbol} (${formatPnL(summary.bestPerformingToken.pnlUsd)})\n`;
        }
        if (summary.worstPerformingToken) {
            message += `📉 <b>Worst</b>: ${summary.worstPerformingToken.tokenSymbol} (${formatPnL(summary.worstPerformingToken.pnlUsd)})\n`;
        }
        if (summary.bestPerformingToken || summary.worstPerformingToken) message += '\n';
    }
    if (kol.pnlData.tokenMetrics && kol.pnlData.tokenMetrics.length > 0) {
        message += `📈 <b>Top Tokens</b>\n`;
        const topTokens = kol.pnlData.tokenMetrics
            .sort((a, b) => (b.buys.volumeUsd + b.sells.volumeUsd) - (a.buys.volumeUsd + a.sells.volumeUsd))
            .slice(0, 3);
        topTokens.forEach((token, index) => {
            const totalVolume = token.buys.volumeUsd + token.sells.volumeUsd;
            const totalTrades = token.buys.transactionCount + token.sells.transactionCount;
            message += `${index + 1}. ${token.tokenSymbol}: $${formatNumber(totalVolume)} (${totalTrades})\n`;
        });
        message += '\n';
    }
    if (summary.pnlTrendSevenDays && summary.pnlTrendSevenDays.length > 0) {
        message += `🗓 <b>7d PnL</b>\n`;
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const last3 = summary.pnlTrendSevenDays.slice(-3);
        last3.forEach(([timestamp, pnl]) => {
            const date = new Date(timestamp * 1000);
            const dayName = days[date.getDay()];
            message += `${dayName}: ${formatPnL(pnl)} | `;
        });
        message = message.replace(/ \| $/, '\n');
    }
    message += '\n\u2795 Use /track_kol to track this KOL\'s wallet trades.';
    message += '\n<b>Use /kols to return to the list view</b>';
    return message;
}

// Update keyboard for KOL detail view to remove 'Back to List' button
function createKOLDetailKeyboard(kolNumber: number, twitterUrl?: string): TelegramBot.InlineKeyboardMarkup {
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    if (twitterUrl) {
        buttons.push([
            {
                text: 'View on X',
                url: twitterUrl
            }
        ]);
    }
    return { inline_keyboard: buttons };
}

// Define a type for the change data (adjust as needed based on Phase 3)
export interface KOLChangeData {
    newNumberOne?: { name: string; address: string };
    newEntrantsTop5?: { name: string; address: string }[];
}

// Format KOL update message with handle and Vybe URL
async function formatKOLUpdateMessageWithLinks(changeData: KOLChangeData): Promise<{ message: string; image: string }> {
    // Fetch all KOL accounts for lookup
    const kolAccounts = await getKOLAccounts();
    const kolLookup = new Map();
    if (kolAccounts) {
        kolAccounts.forEach(kol => {
            kolLookup.set(kol.ownerAddress, kol);
        });
    }
    let message = `🏆 <b>KOL Ranking Update!</b> 🏆\n`;
    let changesExist = false;
    if (changeData.newNumberOne) {
        const kol = kolLookup.get(changeData.newNumberOne.address);
        let handle = kol && kol.twitterUrl ? kol.twitterUrl.replace(/.*\/(\w+)$/, '@$1') : '';
        let vybeUrl = `https://vybe.fyi/wallets/${changeData.newNumberOne.address}?tab=trading`;
        message += `\n🥇 New #1: <b>${changeData.newNumberOne.name}</b> ${handle}\n<a href=\"${vybeUrl}\">View on Vybe</a>\n`;
        changesExist = true;
    }
    if (changeData.newEntrantsTop5 && changeData.newEntrantsTop5.length > 0) {
        message += `\n🚀 New in Top 5:\n`;
        changeData.newEntrantsTop5.forEach(kolData => {
            const kol = kolLookup.get(kolData.address);
            let handle = kol && kol.twitterUrl ? kol.twitterUrl.replace(/.*\/(\w+)$/, '@$1') : '';
            let vybeUrl = `https://vybe.fyi/wallets/${kolData.address}?tab=trading`;
            message += `- <b>${kolData.name}</b> ${handle} <a href=\"${vybeUrl}\">Vybe</a>\n`;
        });
        changesExist = true;
    }
    if (!changesExist) {
        return { message: '', image: '' };
    }
    message += `\nUse /kols to see the full list.`;
    return { message, image: 'assets/kol_alert.png' };
}

// Broadcast KOL updates to subscribed users
export async function broadcastKOLUpdates(db: any, changes: KOLChangeData) {
    const { message, image } = await formatKOLUpdateMessageWithLinks(changes);
    if (!message) {
        // console.log('No significant KOL changes to broadcast.');
        return;
    }

    try {
        const allUserIds = await getAllUserIds(db);
        const unsubscribedUserIds = await getKolUnsubscribedUserIds(db);
        const unsubscribedSet = new Set(unsubscribedUserIds);

        const targetUserIds = allUserIds.filter(userId => !unsubscribedSet.has(userId));

        // console.log(`Broadcasting KOL update to ${targetUserIds.length} users...`);
        let successCount = 0;
        let errorCount = 0;

        for (const userId of targetUserIds) {
            try {
                await bot.sendPhoto(userId, image, {
                    caption: message,
                    parse_mode: 'HTML'
                });
                successCount++;
                // Rate limiting delay
                await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
            } catch (error: any) {
                errorCount++;
                // console.error(`Failed to send KOL update to user ${userId}:`, error.message || error);
                // If user blocked the bot (error code 403), unsubscribe them
                if (error.response?.statusCode === 403 || error.message?.includes('Forbidden')) {
                    // console.log(`User ${userId} blocked the bot. Unsubscribing from KOL updates.`);
                    try {
                        await addKolUnsubscription(db, userId);
                    } catch (unsubError) {
                        // console.error(`Failed to auto-unsubscribe user ${userId}:`, unsubError);
                    }
                }
            }
        }

        // console.log(`Broadcast completed. ${successCount} users received the update, ${errorCount} errors occurred.`);
    } catch (error) {
        // console.error('Error broadcasting KOL updates:', error);
    }
}

/**
 * Formats a single transfer for display in notifications.
 * (Adapted from pollingService.ts)
 */
function formatSingleTransferLine(transfer: VybeTransfer): string {
    // TODO: Enhance formatting - e.g., show token symbol, amount, direction (in/out)
    // Requires transfer object to potentially include tokenDetails 
    // or fetch them based on mint address if available.
    const time = new Date(transfer.blockTime * 1000).toLocaleTimeString(); // Use time only for brevity
    const explorerUrl = `https://solscan.io/tx/${transfer.signature}`;
    // Basic formatting for now:
    return `💸 ${time} - [View on Solscan](${explorerUrl})`;
}

/**
 * Formats the notification message for new wallet transfers.
 * @param walletAddress The tracked wallet address.
 * @param newTransfers Array of new transfer objects.
 * @returns Formatted message string (Markdown).
 */
export function formatWalletTransferNotification(
    walletAddress: string,
    newTransfers: VybeTransfer[]
): string {
    if (!newTransfers || newTransfers.length === 0) {
        return ''; // Should not happen if called correctly
    }

    // Sort by blockTime descending if not already
    newTransfers.sort((a, b) => b.blockTime - a.blockTime);

    const vybeLink = `https://vybe.fyi/wallets/${walletAddress}?tab=overview&order=blocktime&desc=true`;
    let message = `🔔 *New Transfer(s) for* \`${truncateAddress(walletAddress)}\`\n`
        + `[View All Activity on Vybe](${vybeLink})\n\n`;

    // Add details for each transfer (limit to 5 most recent)
    const transfersToShow = newTransfers.slice(0, 5);
    message += transfersToShow.map(formatSingleTransferLine).join('\n'); // Use single newline

    // If there are more transfers, add a count
    if (newTransfers.length > 5) {
        message += `\n\n📑 _+${newTransfers.length - 5} more transfers_`;
    }

    return message;
}