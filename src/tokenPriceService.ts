import { getAllTrackedTokenPrices, getTokenPrice, calculatePriceChangePercent } from './vybeApi';
import {
    TokenPrice,
    initializeTokenPriceCache,
    getAllTokenPrices,
    getAllUserIds,
    getActiveAlertsForToken,
    markAlertAsTriggered,
    UserPriceAlert
} from './database';
import { PRICE_ALERT_CONFIG } from './config';

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
}

/**
 * Register a callback function to handle price updates
 * @param callback The function to call when prices are updated
 */
export function registerPriceUpdateCallback(callback: PriceUpdateCallback): void {
    priceUpdateCallback = callback;
}

/**
 * Initialize token prices in database
 * @param db Database connection
 */
export async function initializeTokenPrices(db: any): Promise<boolean> {
    try {
        const tokenPrices = await getAllTrackedTokenPrices();

        if (tokenPrices.length === 0) {
            return false;
        }

        // Initialize each token in the database
        const results = await Promise.all(
            tokenPrices.map(token => initializeTokenPriceCache(db, token))
        );

        const successCount = results.filter(Boolean).length;

        // Add initial price history entries to in-memory storage
        const now = Math.floor(Date.now() / 1000);
        tokenPrices.forEach(token => {
            addPriceHistoryPoint(token.mint_address, token.current_price, now);
        });

        return successCount > 0;
    } catch (error) {
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

        // Process each alert to see if the target has been hit
        for (const alert of activeAlerts) {
            // Price going up case (waiting for price to reach or exceed target)
            if (alert.is_above_target &&
                previousPrice < alert.target_price &&
                token.current_price >= alert.target_price) {

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

                // Notify through callback
                if (alertCallback) {
                    await alertCallback('target', token, { userAlert: alert });
                }

                // Mark as triggered
                await markAlertAsTriggered(db, alert.id);
            }
        }
    } catch (error) {
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
            return true;
        }

        return false;
    } catch (error) {
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
    const mintAddress = token.mint_address;

    try {
        await initializeTokenPriceCache(db, token);
    } catch (error) {
        // Continue processing even if cache update fails
    }

    const previousPrice = previousPrices[mintAddress] ?? 0;
    addPriceHistoryPoint(mintAddress, token.current_price, Math.floor(Date.now() / 1000));

    if (previousPrice <= 0) {
        return;
    }

    const percentChange = calculatePriceChangePercent(token.current_price, previousPrice);

    if (priceUpdateCallback) {
        priceUpdateCallback(token, {
            percentChange,
            previousPrice: previousPrice
        });
    }

    await checkPriceTargets(db, token, previousPrice);
}

/**
 * Poll for token price updates and process changes
 * @param db Database connection
 */
export async function pollTokenPrices(db: any): Promise<boolean> {
    const pollStartTime = Date.now();

    if (isPolling) {
        return false;
    }

    isPolling = true;
    lastPollTime = Date.now();

    try {
        // Fetch current prices for all tracked tokens
        const currentTokenPrices = await getAllTrackedTokenPrices();

        if (!currentTokenPrices || currentTokenPrices.length === 0) {
        } else {
        }

        // Get previous prices from database
        const previousTokenPrices = await getAllTokenPrices(db);
        const previousPrices: { [key: string]: number } = {};

        // Create a map for easy lookup
        previousTokenPrices.forEach(token => {
            previousPrices[token.mint_address] = token.current_price;
        });

        // Process each token update
        await Promise.all(
            currentTokenPrices.map(token => processTokenUpdate(db, token, previousPrices))
        );

        return true;
    } catch (error) {
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
    if (isPolling) {
        return false;
    }

    try {
        // Initialize token prices
        const initialized = await initializeTokenPrices(db);

        if (!initialized) {
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
                    // Clear current interval and set a longer one
                    if (pollingInterval) {
                        clearInterval(pollingInterval);
                    }
                    // Use exponential backoff with a maximum of 10 minutes
                    const backoffMs = Math.min(
                        PRICE_ALERT_CONFIG.pollingIntervalMs * Math.pow(2, consecutiveFailures - MAX_CONSECUTIVE_FAILURES),
                        10 * 60 * 1000
                    );

                    // Set a one-time timeout that will reset the normal polling when it succeeds
                    setTimeout(async () => {
                        const success = await pollTokenPrices(db);
                        if (success) {
                            // Reset to normal polling interval
                            if (pollingInterval) {
                                clearInterval(pollingInterval);
                            }
                            pollingInterval = setInterval(() => pollTokenPrices(db), PRICE_ALERT_CONFIG.pollingIntervalMs);
                        }
                    }, backoffMs);
                    return;
                }

                await pollTokenPrices(db);
            } catch (error) {
            }
        }, PRICE_ALERT_CONFIG.pollingIntervalMs);

        // Do an initial poll immediately
        await pollTokenPrices(db);

        return true;
    } catch (error) {
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
        isPolling = false;
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
            return false;
        }

        // Create simulated new price
        const oldPrice = token.current_price;
        const newPrice = oldPrice * (1 + percentChange / 100);

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
        return false;
    }
}
