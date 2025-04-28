import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { walletLog } from './logger';
import { TRACKED_TOKENS, PRICE_ALERT_CONFIG } from './config';

// Token price interfaces
export interface TokenPrice {
    mint_address: string;
    symbol: string;
    name: string;
    current_price: number;
    last_update_time: number;
}

export interface UserPriceAlert {
    id: number;
    user_id: number;
    mint_address: string;
    target_price: number;
    is_above_target: boolean;
    is_triggered: boolean;
    created_at: string;
    // Include additional fields from join queries
    symbol?: string;
    name?: string;
    current_price?: number;
}

// Initialize the database and create necessary tables
export async function initializeDatabase() {
    const dbPath = process.env.DATABASE_PATH || './vybe_bot.db';
    console.log(`Initializing database at: ${dbPath}`);

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Create users table if it doesn't exist
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create tracked_wallets table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS tracked_wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            wallet_address TEXT NOT NULL,
            label TEXT,
            last_notified_tx_signature TEXT,
            last_processed_block_time INTEGER, -- Unix timestamp (seconds since epoch)
            tracking_started_at INTEGER, -- Unix timestamp when tracking began
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id),
            UNIQUE(user_id, wallet_address)
        )
    `);

    // Add columns if they don't exist (for upgrading existing databases)
    try {
        await db.exec(`ALTER TABLE tracked_wallets ADD COLUMN last_processed_block_time INTEGER;`);
        console.log('Added last_processed_block_time column to tracked_wallets table');
    } catch (e) {
        // Column likely already exists
    }

    try {
        await db.exec(`ALTER TABLE tracked_wallets ADD COLUMN tracking_started_at INTEGER;`);
        console.log('Added tracking_started_at column to tracked_wallets table');
    } catch (e) {
        // Column likely already exists
    }

    // Create token price tracking tables

    // Token price cache table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS token_prices (
            mint_address TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            current_price REAL,
            last_update_time INTEGER,  -- Unix timestamp
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Price history for tracked tokens
    await db.exec(`
        CREATE TABLE IF NOT EXISTS token_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mint_address TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp INTEGER NOT NULL,  -- Unix timestamp
            FOREIGN KEY(mint_address) REFERENCES token_prices(mint_address)
        )
    `);

    // User specific price alerts
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_price_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            mint_address TEXT NOT NULL,
            target_price REAL NOT NULL,
            is_above_target BOOLEAN NOT NULL,  -- true if waiting for price to go above target
            is_triggered BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
    `);

    // Global subscriptions for general price movement alerts
    await db.exec(`
        CREATE TABLE IF NOT EXISTS token_alert_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            mint_address TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id),
            UNIQUE(user_id, mint_address)
        )
    `);

    return db;
}

// Get count of wallets tracked by a user
export async function getTrackedWalletCount(db: any, userId: number): Promise<number> {
    const result = await db.get(
        'SELECT COUNT(*) as count FROM tracked_wallets WHERE user_id = ?',
        [userId]
    );
    return result.count;
}

// Add a new wallet to track
export async function addTrackedWallet(db: any, userId: number, walletAddress: string) {
    // First ensure user exists
    await db.run(
        'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
        [userId]
    );

    // Check if user has reached the wallet limit
    const MAX_WALLETS_PER_USER = 5;
    const currentCount = await getTrackedWalletCount(db, userId);

    if (currentCount >= MAX_WALLETS_PER_USER) {
        throw new Error(`You've reached the maximum limit of ${MAX_WALLETS_PER_USER} tracked wallets. Please remove some before adding more.`);
    }

    // Get current Unix timestamp
    const now = Math.floor(Date.now() / 1000);

    // Then add the wallet
    await db.run(
        `INSERT INTO tracked_wallets (
            user_id, 
            wallet_address, 
            last_notified_tx_signature,
            last_processed_block_time,
            tracking_started_at
        )
        VALUES (?, ?, NULL, ?, ?)
        ON CONFLICT(user_id, wallet_address) DO NOTHING`,
        [userId, walletAddress, now, now]
    );

    // Log that the wallet is now being tracked
    walletLog(walletAddress, userId, 'Wallet tracking started', {
        tracked_at: now,
        last_notified_tx_signature: null,
        last_processed_block_time: now
    });
}

// Get all tracked wallets with their last notified transaction signature
export async function getAllTrackedWalletsWithState(db: any) {
    return await db.all(`
        SELECT 
            user_id, 
            wallet_address, 
            last_notified_tx_signature, 
            last_processed_block_time,
            tracking_started_at,
            created_at
        FROM tracked_wallets
    `);
}

// Update the last notified transaction signature and block time for a wallet
export async function updateLastNotifiedSignature(
    db: any,
    userId: number,
    walletAddress: string,
    signature: string,
    blockTime: number
) {
    await db.run(
        `UPDATE tracked_wallets
         SET 
            last_notified_tx_signature = ?,
            last_processed_block_time = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND wallet_address = ?`,
        [signature, blockTime, userId, walletAddress]
    );
}

// Get all wallets tracked by a specific user
export async function getUserTrackedWallets(db: any, userId: number) {
    return await db.all(
        `SELECT wallet_address, label, tracking_started_at 
         FROM tracked_wallets 
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [userId]
    );
}

// Remove a tracked wallet
export async function removeTrackedWallet(db: any, userId: number, walletAddress: string) {
    const result = await db.run(
        `DELETE FROM tracked_wallets
         WHERE user_id = ? AND wallet_address = ?`,
        [userId, walletAddress]
    );

    if (result.changes === 0) {
        throw new Error(`You are not tracking wallet ${walletAddress}.`);
    }

    // Log that the wallet is no longer being tracked
    walletLog(walletAddress, userId, 'Wallet tracking stopped', {
        removed_at: Math.floor(Date.now() / 1000)
    });

    return true;
}

// Get all unique user IDs from the users table
export async function getAllUserIds(db: any): Promise<number[]> {
    try {
        const rows: { user_id: number }[] = await db.all('SELECT DISTINCT user_id FROM users');
        return rows.map((row: { user_id: number }) => row.user_id);
    } catch (error) {
        console.error('Error getting all user IDs:', error);
        return [];
    }
}

// =====================================================================
// Token Price Alert Functions
// =====================================================================

// Initialize or update token price cache
export async function initializeTokenPriceCache(db: any, tokenDetails: TokenPrice) {
    try {
        await db.run(
            `INSERT INTO token_prices (
                mint_address, symbol, name, current_price, last_update_time
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(mint_address) DO UPDATE SET
                symbol = excluded.symbol,
                name = excluded.name,
                current_price = excluded.current_price,
                last_update_time = excluded.last_update_time
            `,
            [
                tokenDetails.mint_address,
                tokenDetails.symbol,
                tokenDetails.name,
                tokenDetails.current_price,
                tokenDetails.last_update_time
            ]
        );
        return true;
    } catch (error) {
        console.error(`Error initializing token price cache for ${tokenDetails.mint_address}:`, error);
        return false;
    }
}

// Get token price from cache
export async function getTokenPrice(db: any, mintAddress: string): Promise<TokenPrice | null> {
    try {
        const tokenPrice = await db.get(
            'SELECT * FROM token_prices WHERE mint_address = ?',
            [mintAddress]
        );
        return tokenPrice;
    } catch (error) {
        console.error(`Error getting token price for ${mintAddress}:`, error);
        return null;
    }
}

// Get all token prices from cache
export async function getAllTokenPrices(db: any): Promise<TokenPrice[]> {
    try {
        return await db.all('SELECT * FROM token_prices');
    } catch (error) {
        console.error('Error getting all token prices:', error);
        return [];
    }
}

// Add price history entry
export async function addPriceHistoryEntry(
    db: any,
    mintAddress: string,
    price: number,
    timestamp: number
): Promise<boolean> {
    // This function is now deprecated - we're using in-memory storage instead
    console.warn('addPriceHistoryEntry is deprecated - using in-memory storage instead');
    return true;
}

// Subscribe user to general price alerts for a token
export async function subscribeToTokenAlerts(
    db: any,
    userId: number,
    mintAddress: string
): Promise<boolean> {
    try {
        // First ensure user exists
        await db.run(
            'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
            [userId]
        );

        // Then add the subscription
        await db.run(
            `INSERT OR IGNORE INTO token_alert_subscriptions (
                user_id, mint_address
            ) VALUES (?, ?)`,
            [userId, mintAddress]
        );
        return true;
    } catch (error) {
        console.error(`Error subscribing user ${userId} to alerts for ${mintAddress}:`, error);
        return false;
    }
}

// Unsubscribe user from general price alerts for a token
export async function unsubscribeFromTokenAlerts(
    db: any,
    userId: number,
    mintAddress: string
): Promise<boolean> {
    try {
        const result = await db.run(
            `DELETE FROM token_alert_subscriptions
             WHERE user_id = ? AND mint_address = ?`,
            [userId, mintAddress]
        );

        return result.changes > 0;
    } catch (error) {
        console.error(`Error unsubscribing user ${userId} from alerts for ${mintAddress}:`, error);
        return false;
    }
}

// Get all token alert subscriptions for a user
export async function getUserTokenSubscriptions(db: any, userId: number): Promise<Array<{
    mint_address: string;
    symbol: string;
    name: string;
    current_price: number;
}>> {
    try {
        return await db.all(
            `SELECT tas.mint_address, tp.symbol, tp.name, tp.current_price
             FROM token_alert_subscriptions tas
             LEFT JOIN token_prices tp ON tas.mint_address = tp.mint_address
             WHERE tas.user_id = ?`,
            [userId]
        );
    } catch (error) {
        console.error(`Error getting token subscriptions for user ${userId}:`, error);
        return [];
    }
}

// Get count of token alerts subscribed by a user
export async function getTokenSubscriptionCount(db: any, userId: number): Promise<number> {
    try {
        const result = await db.get(
            'SELECT COUNT(*) as count FROM token_alert_subscriptions WHERE user_id = ?',
            [userId]
        );
        return result.count;
    } catch (error) {
        console.error(`Error getting token subscription count for user ${userId}:`, error);
        return 0;
    }
}

// Get all users subscribed to a specific token
export async function getTokenSubscribers(db: any, mintAddress: string): Promise<number[]> {
    try {
        const subscribers = await db.all(
            'SELECT user_id FROM token_alert_subscriptions WHERE mint_address = ?',
            [mintAddress]
        );
        return subscribers.map((row: { user_id: number }) => row.user_id);
    } catch (error) {
        console.error(`Error getting subscribers for token ${mintAddress}:`, error);
        return [];
    }
}

// Create a specific price alert for a user
export async function createPriceAlert(
    db: any,
    userId: number,
    mintAddress: string,
    targetPrice: number,
    isAboveTarget: boolean
): Promise<number | null> {
    try {
        // First ensure user exists
        await db.run(
            'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
            [userId]
        );

        // Check if user has reached the alert limit
        const currentCount = await db.get(
            'SELECT COUNT(*) as count FROM user_price_alerts WHERE user_id = ? AND is_triggered = 0',
            [userId]
        );

        if (currentCount.count >= PRICE_ALERT_CONFIG.maxAlertsPerUser) {
            throw new Error(`You've reached the maximum limit of ${PRICE_ALERT_CONFIG.maxAlertsPerUser} active price alerts. Please remove some before adding more.`);
        }

        // Create the price alert
        const result = await db.run(
            `INSERT INTO user_price_alerts (
                user_id, mint_address, target_price, is_above_target
            ) VALUES (?, ?, ?, ?)`,
            [userId, mintAddress, targetPrice, isAboveTarget ? 1 : 0]
        );

        return result.lastID;
    } catch (error) {
        console.error(`Error creating price alert for user ${userId} on token ${mintAddress}:`, error);
        if (error instanceof Error) {
            throw error; // Re-throw user-facing errors
        }
        return null;
    }
}

// Get all active price alerts for a user
export async function getUserPriceAlerts(db: any, userId: number): Promise<UserPriceAlert[]> {
    try {
        return await db.all(
            `SELECT 
                upa.*, 
                tp.symbol, 
                tp.name, 
                tp.current_price
             FROM user_price_alerts upa
             LEFT JOIN token_prices tp ON upa.mint_address = tp.mint_address
             WHERE upa.user_id = ? AND upa.is_triggered = 0
             ORDER BY upa.created_at DESC`,
            [userId]
        );
    } catch (error) {
        console.error(`Error getting price alerts for user ${userId}:`, error);
        return [];
    }
}

// Get a specific price alert by ID
export async function getPriceAlertById(db: any, alertId: number): Promise<UserPriceAlert | null> {
    try {
        return await db.get(
            `SELECT 
                upa.*, 
                tp.symbol, 
                tp.name, 
                tp.current_price
             FROM user_price_alerts upa
             LEFT JOIN token_prices tp ON upa.mint_address = tp.mint_address
             WHERE upa.id = ?`,
            [alertId]
        );
    } catch (error) {
        console.error(`Error getting price alert ${alertId}:`, error);
        return null;
    }
}

// Remove a price alert
export async function removePriceAlert(db: any, userId: number, alertId: number): Promise<boolean> {
    try {
        const result = await db.run(
            `DELETE FROM user_price_alerts
             WHERE id = ? AND user_id = ?`,
            [alertId, userId]
        );

        if (result.changes === 0) {
            throw new Error(`Alert not found or you don't have permission to delete it.`);
        }

        return true;
    } catch (error) {
        console.error(`Error removing price alert ${alertId} for user ${userId}:`, error);
        if (error instanceof Error) {
            throw error; // Re-throw user-facing errors
        }
        return false;
    }
}

// Mark a price alert as triggered
export async function markAlertAsTriggered(db: any, alertId: number): Promise<boolean> {
    try {
        const result = await db.run(
            `UPDATE user_price_alerts
             SET is_triggered = 1
             WHERE id = ?`,
            [alertId]
        );

        return result.changes > 0;
    } catch (error) {
        console.error(`Error marking alert ${alertId} as triggered:`, error);
        return false;
    }
}

// Get all active price alerts for a token
export async function getActiveAlertsForToken(db: any, mintAddress: string): Promise<UserPriceAlert[]> {
    try {
        return await db.all(
            `SELECT * FROM user_price_alerts
             WHERE mint_address = ? AND is_triggered = 0`,
            [mintAddress]
        );
    } catch (error) {
        console.error(`Error getting active alerts for token ${mintAddress}:`, error);
        return [];
    }
} 