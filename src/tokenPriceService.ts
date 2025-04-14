import { getAllTrackedTokenPrices, getTokenPrice, calculatePriceChangePercent } from './vybeApi';
import {
    TokenPrice,
    initializeTokenPriceCache,
    addPriceHistoryEntry,
    getAllTokenPrices,
    getTokenSubscribers,
    getActiveAlertsForToken,
    markAlertAsTriggered,
    UserPriceAlert
} from './database';
import { TRACKED_TOKENS, PRICE_ALERT_CONFIG } from './config';

// Global variables for service state
let isPolling = false;
let pollingInterval: NodeJS.Timeout | null = null;
let lastPollTime = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

// In-memory price history with limited retention
interface PricePoint {
    price: number;
    timestamp: number;
}

const tokenPriceHistory: {
    [mintAddress: string]: PricePoint[]
} = {};

// Maximum history points to keep per token (1 point per minute, 60 points = 1 hour of data)
const MAX_HISTORY_POINTS = 60;

/**
 * Add a new price point to the in-memory history
 * @param mintAddress Token mint address
 * @param price Current price
 * @param timestamp Unix timestamp
 */
function addPriceHistoryPoint(mintAddress: string, price: number, timestamp: number): void {
    // Initialize array if it doesn't exist
    if (!tokenPriceHistory[mintAddress]) {
        tokenPriceHistory[mintAddress] = [];
    }

    // Add new price point
    tokenPriceHistory[mintAddress].push({ price, timestamp });

    // Remove oldest entry if we exceed the limit
    if (tokenPriceHistory[mintAddress].length > MAX_HISTORY_POINTS) {
        tokenPriceHistory[mintAddress].shift();
    }
}

/**
 * Get recent price history for a token
 * @param mintAddress Token mint address
 * @param limit Number of data points to return (most recent first)
 * @returns Array of price points
 */
function getTokenPriceHistoryPoints(mintAddress: string, limit: number = 24): PricePoint[] {
    const history = tokenPriceHistory[mintAddress] || [];
    return history.slice(-Math.min(limit, history.length)).reverse();
}

/**
 * Get token price history - exported for external use
 * @param db Database connection (not used, just for compatibility)
 * @param mintAddress Token mint address
 * @param limit Number of data points to return
 * @returns Array of price points
 */
export function getTokenPriceHistory(
    db: any,
    mintAddress: string,
    limit: number = 24
): PricePoint[] {
    return getTokenPriceHistoryPoints(mintAddress, limit);
}

// Event callback type for handling price alerts
export type PriceAlertCallback = (
    alertType: 'general' | 'target',
    token: TokenPrice,
    data: {
        percentChange?: number;
        previousPrice?: number;
        userIds?: number[];
        userAlert?: UserPriceAlert;
    }
) => Promise<void>;

// Global event handler
let alertCallback: PriceAlertCallback | null = null;

// External price update callback
export type PriceUpdateCallback = (
    token: TokenPrice,
    changeData: {
        percentChange: number;
        previousPrice: number;
    }
) => void;

let priceUpdateCallback: PriceUpdateCallback | null = null;

/**
 * Register a callback function to handle price alerts
 * @param callback The function to call when price alerts are triggered
 */
export function registerAlertCallback(callback: PriceAlertCallback): void {
    alertCallback = callback;
    console.log('Alert callback registered');
}

/**
 * Register a callback function to handle price updates
 * @param callback The function to call when prices are updated
 */
export function registerPriceUpdateCallback(callback: PriceUpdateCallback): void {
    priceUpdateCallback = callback;
    console.log('Price update callback registered');
}

/**
 * Initialize token prices in database
 * @param db Database connection
 */
export async function initializeTokenPrices(db: any): Promise<boolean> {
    try {
        console.log('Initializing token prices...');
        const tokenPrices = await getAllTrackedTokenPrices();

        if (tokenPrices.length === 0) {
            console.error('Failed to fetch any token prices during initialization');
            return false;
        }

        // Initialize each token in the database
        const results = await Promise.all(
            tokenPrices.map(token => initializeTokenPriceCache(db, token))
        );

        const successCount = results.filter(Boolean).length;
        console.log(`Initialized ${successCount}/${tokenPrices.length} token prices`);

        // Add initial price history entries to in-memory storage
        const now = Math.floor(Date.now() / 1000);
        tokenPrices.forEach(token => {
            addPriceHistoryPoint(token.mint_address, token.current_price, now);
        });

        return successCount > 0;
    } catch (error) {
        console.error('Error initializing token prices:', error);
        return false;
    }
}

/**
 * Check for specific price targets that have been hit
 * @param db Database connection 
 * @param token Current token price data
 * @param previousPrice Previous token price
 */
async function checkPriceTargets(
    db: any,
    token: TokenPrice,
    previousPrice: number
): Promise<void> {
    // Skip if no previous price or no price change
    if (previousPrice <= 0 || token.current_price === previousPrice) {
        return;
    }

    try {
        // Get all active alerts for this token
        const activeAlerts = await getActiveAlertsForToken(db, token.mint_address);

        if (activeAlerts.length === 0) {
            return;
        }

        console.log(`Checking ${activeAlerts.length} price targets for ${token.symbol}`);

        // Process each alert to see if the target has been hit
        for (const alert of activeAlerts) {
            // Price going up case (waiting for price to reach or exceed target)
            if (alert.is_above_target &&
                previousPrice < alert.target_price &&
                token.current_price >= alert.target_price) {

                console.log(
                    `🎯 Price target hit for ${token.symbol}: ` +
                    `Crossed above ${alert.target_price.toFixed(4)} ` +
                    `(Current: ${token.current_price.toFixed(4)}), ` +
                    `User: ${alert.user_id}`
                );

                // Notify through callback
                if (alertCallback) {
                    await alertCallback('target', token, { userAlert: alert });
                }

                // Mark as triggered
                await markAlertAsTriggered(db, alert.id);
            }
            // Price going down case (waiting for price to fall to or below target)
            else if (!alert.is_above_target &&
                previousPrice > alert.target_price &&
                token.current_price <= alert.target_price) {

                console.log(
                    `🎯 Price target hit for ${token.symbol}: ` +
                    `Crossed below ${alert.target_price.toFixed(4)} ` +
                    `(Current: ${token.current_price.toFixed(4)}), ` +
                    `User: ${alert.user_id}`
                );

                // Notify through callback
                if (alertCallback) {
                    await alertCallback('target', token, { userAlert: alert });
                }

                // Mark as triggered
                await markAlertAsTriggered(db, alert.id);
            }
        }
    } catch (error) {
        console.error(`Error checking price targets for ${token.mint_address}:`, error);
    }
}

/**
 * Detect rapid price movements that might indicate volatility
 * @param token Current token data
 * @returns True if rapid movement detected
 */
function detectRapidPriceMovement(token: TokenPrice): boolean {
    try {
        // Get recent price history (last 10 data points)
        const history = getTokenPriceHistoryPoints(token.mint_address, 10);

        // Need at least 3 data points for this analysis
        if (history.length < 3) {
            return false;
        }

        // Get prices sorted by time (newest first is default)
        const prices = history.map(h => h.price);

        // Check for price reversal pattern (up then down or down then up)
        const newest = prices[0];
        const middle = prices[1];
        const older = prices[2];

        // Calculate changes
        const recentChange = calculatePriceChangePercent(newest, middle);
        const previousChange = calculatePriceChangePercent(middle, older);

        // Detect reversal (sign change) with significant movements
        const isReversal = (recentChange * previousChange < 0) &&
            (Math.abs(recentChange) > 2) &&
            (Math.abs(previousChange) > 2);

        // Detect acceleration (same direction but increasing rate of change)
        const isAccelerating = (recentChange * previousChange > 0) &&
            (Math.abs(recentChange) > Math.abs(previousChange) * 1.5);

        if (isReversal || isAccelerating) {
            const pattern = isReversal ? 'reversal' : 'acceleration';
            console.log(
                `⚠️ Rapid price movement (${pattern}) detected for ${token.symbol}: ` +
                `Recent change: ${recentChange.toFixed(2)}%, ` +
                `Previous change: ${previousChange.toFixed(2)}%`
            );
            return true;
        }

        return false;
    } catch (error) {
        console.error(`Error detecting rapid price movement for ${token.mint_address}:`, error);
        return false;
    }
}

/**
 * Process token price update
 * @param db Database connection
 * @param token Current token data
 * @param previousPrices Previous prices for all tokens
 */
async function processTokenUpdate(
    db: any,
    token: TokenPrice,
    previousPrices: { [key: string]: number } = {}
): Promise<void> {
    try {
        // Get previous price
        const prevPrice = previousPrices[token.mint_address] || 0;

        // Store current price data 
        addPriceHistoryPoint(token.mint_address, token.current_price, Math.floor(Date.now() / 1000));

        // Skip alert processing if we don't have a previous price
        if (prevPrice <= 0) {
            return;
        }

        // Calculate percentage change
        const percentChange = calculatePriceChangePercent(token.current_price, prevPrice);

        // Call the price update callback if registered
        if (priceUpdateCallback) {
            priceUpdateCallback(token, {
                percentChange,
                previousPrice: prevPrice
            });
        }

        // Check for target price alerts first
        await checkPriceTargets(db, token, prevPrice);

        // Check if change exceeds threshold for general alerts
        const absChange = Math.abs(percentChange);
        if (absChange >= PRICE_ALERT_CONFIG.generalAlertThresholdPercent) {
            // Get all users subscribed to this token
            const subscribers = await getTokenSubscribers(db, token.mint_address);

            if (subscribers.length > 0) {
                console.log(
                    `🚨 Significant price movement for ${token.symbol}: ` +
                    `${percentChange.toFixed(2)}% change to $${token.current_price.toFixed(4)}, ` +
                    `notifying ${subscribers.length} subscribers`
                );

                // Notify through callback
                if (alertCallback) {
                    await alertCallback('general', token, {
                        percentChange,
                        previousPrice: prevPrice,
                        userIds: subscribers
                    });
                }
            }
        }
    } catch (error) {
        console.error(`Error processing update for ${token.symbol}:`, error);
    }
}

/**
 * Poll for token price updates and process changes
 * @param db Database connection
 */
export async function pollTokenPrices(db: any): Promise<boolean> {
    if (isPolling) {
        console.log('Already polling for token prices, skipping');
        return false;
    }

    isPolling = true;
    lastPollTime = Date.now();

    try {
        // Get previous prices from database
        const previousTokens = await getAllTokenPrices(db);
        const previousPrices: { [key: string]: number } = {};

        // Create a map for easy lookup
        previousTokens.forEach(token => {
            previousPrices[token.mint_address] = token.current_price;
        });

        // Fetch latest prices
        const tokenPrices = await getAllTrackedTokenPrices();

        if (tokenPrices.length === 0) {
            console.error('Failed to fetch any token prices during polling');
            consecutiveFailures++;
            return false;
        }

        // Reset failure counter on success
        consecutiveFailures = 0;

        // Process each token update
        await Promise.all(
            tokenPrices.map(token => processTokenUpdate(db, token, previousPrices))
        );

        console.log(`Successfully polled ${tokenPrices.length} token prices`);
        return true;
    } catch (error) {
        console.error('Error polling token prices:', error);
        consecutiveFailures++;
        return false;
    } finally {
        isPolling = false;
    }
}

/**
 * Start the token price polling service
 * @param db Database connection
 */
export async function startTokenPriceService(db: any): Promise<boolean> {
    try {
        console.log('Starting token price service...');

        // Initialize token prices
        const initialized = await initializeTokenPrices(db);

        if (!initialized) {
            console.error('Failed to initialize token prices, but continuing with service start');
        }

        // Stop any existing polling
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }

        // Start polling at the configured interval
        pollingInterval = setInterval(async () => {
            try {
                // If too many consecutive failures, increase polling interval temporarily
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.warn(`${consecutiveFailures} consecutive failures, backing off...`);
                    // Clear current interval and set a longer one
                    if (pollingInterval) {
                        clearInterval(pollingInterval);
                    }
                    // Use exponential backoff with a maximum of 10 minutes
                    const backoffMs = Math.min(
                        PRICE_ALERT_CONFIG.pollingIntervalMs * Math.pow(2, consecutiveFailures - MAX_CONSECUTIVE_FAILURES),
                        10 * 60 * 1000
                    );
                    console.log(`Setting temporary polling interval to ${backoffMs}ms`);

                    // Set a one-time timeout that will reset the normal polling when it succeeds
                    setTimeout(async () => {
                        const success = await pollTokenPrices(db);
                        if (success) {
                            // Reset to normal polling interval
                            if (pollingInterval) {
                                clearInterval(pollingInterval);
                            }
                            pollingInterval = setInterval(() => pollTokenPrices(db), PRICE_ALERT_CONFIG.pollingIntervalMs);
                            console.log('Resumed normal polling interval');
                        }
                    }, backoffMs);
                    return;
                }

                await pollTokenPrices(db);
            } catch (error) {
                console.error('Error in polling interval:', error);
            }
        }, PRICE_ALERT_CONFIG.pollingIntervalMs);

        console.log(`Token price service started, polling every ${PRICE_ALERT_CONFIG.pollingIntervalMs / 1000} seconds`);

        // Do an initial poll immediately
        await pollTokenPrices(db);

        return true;
    } catch (error) {
        console.error('Error starting token price service:', error);
        return false;
    }
}

/**
 * Stop the token price polling service
 */
export function stopTokenPriceService(): void {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('Token price service stopped');
    }
}

/**
 * Get the time since last successful poll
 * @returns Time in milliseconds since last poll
 */
export function getTimeSinceLastPoll(): number {
    return Date.now() - lastPollTime;
}

/**
 * Get token price change over a specific time period
 * @param db Database connection
 * @param mintAddress Token mint address
 * @param periodHours Time period in hours
 * @returns Percentage change or null if not enough data
 */
export async function getTokenPriceChange(
    db: any,
    mintAddress: string,
    periodHours: number = 24
): Promise<number | null> {
    try {
        // Get current price
        const current = await getTokenPrice(mintAddress);
        if (!current) return null;

        // For 24h or 7d changes, we can't rely on the API directly as our TokenPrice doesn't have these fields
        // Instead we'll use our in-memory history for all periods
        const history = getTokenPriceHistoryPoints(mintAddress);
        if (history.length === 0) return null;

        // Find the oldest price within our period
        const oldestTimestamp = Math.floor(Date.now() / 1000) - (periodHours * 3600);
        const oldestPricePoint = history.find(h => h.timestamp <= oldestTimestamp);

        // If no price old enough, use the oldest we have
        const previousPrice = oldestPricePoint
            ? oldestPricePoint.price
            : history[history.length - 1].price;

        return calculatePriceChangePercent(current.current_price, previousPrice);
    } catch (error) {
        console.error(`Error calculating price change for ${mintAddress}:`, error);
        return null;
    }
}

/**
 * Get service status for diagnostic purposes
 */
export function getPriceServiceStatus(): {
    isPolling: boolean;
    lastPollTime: number;
    timeSinceLastPoll: number;
    consecutiveFailures: number;
    pollingIntervalMs: number;
    historyPoints: { [key: string]: number };
} {
    // Count price history points per token
    const historyPoints: { [key: string]: number } = {};
    Object.keys(tokenPriceHistory).forEach(mint => {
        historyPoints[mint] = tokenPriceHistory[mint].length;
    });

    return {
        isPolling,
        lastPollTime,
        timeSinceLastPoll: getTimeSinceLastPoll(),
        consecutiveFailures,
        pollingIntervalMs: PRICE_ALERT_CONFIG.pollingIntervalMs,
        historyPoints
    };
}

/**
 * Simulate a price change for testing purposes
 * @param db Database connection
 * @param mintAddress Token mint address
 * @param percentChange Percentage to change the price (can be positive or negative)
 * @returns True if simulation was successful
 */
export async function simulatePriceChange(
    db: any,
    mintAddress: string,
    percentChange: number
): Promise<boolean> {
    try {
        // Get current token
        const tokens = await getAllTokenPrices(db);
        const token = tokens.find(t => t.mint_address === mintAddress);
        if (!token) {
            console.error(`Token with mint address ${mintAddress} not found`);
            return false;
        }

        // Create simulated new price
        const oldPrice = token.current_price;
        const newPrice = oldPrice * (1 + percentChange / 100);

        console.log(`[${new Date().toISOString()}] Simulating ${percentChange}% price change for ${token.symbol}: ${oldPrice.toFixed(6)} → ${newPrice.toFixed(6)}`);

        // Create a modified token object with the new price
        const modifiedToken: TokenPrice = {
            ...token,
            current_price: newPrice,
            last_update_time: Math.floor(Date.now() / 1000)
        };

        // Create a map of previous prices
        const previousPrices: { [key: string]: number } = {
            [mintAddress]: oldPrice
        };

        // Process the update (this will trigger alerts if threshold is met)
        await processTokenUpdate(db, modifiedToken, previousPrices);

        // Also update the database directly for consistency
        await initializeTokenPriceCache(db, modifiedToken);

        return true;
    } catch (error) {
        console.error('Error simulating price change:', error);
        return false;
    }
}
