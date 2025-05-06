import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { walletLog } from '../logger';
import { PRICE_ALERT_CONFIG } from '../config';
import fs from 'fs';
import path from 'path';
import { KnownAccount } from '../vybeApi'; // Import KnownAccount type

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
    // Try using the environment variable, but have fallbacks
    let dbPath = process.env.DATABASE_PATH;

    if (!dbPath) {
        dbPath = './vybe_bot.db'; // Default to local directory
    }

    // console.log(`Attempting to initialize database at: ${dbPath}`);

    // Check if the directory is accessible/writable before proceeding
    try {
        const dbDir = path.dirname(dbPath);

        // Skip directory creation for current dir
        if (dbDir !== '.' && !fs.existsSync(dbDir)) {
            try {
                // console.log(`Creating database directory: ${dbDir}`);
                fs.mkdirSync(dbDir, { recursive: true });
                // console.log(`Successfully created directory: ${dbDir}`);
            } catch (dirError: any) {
                // console.error(`Error creating directory ${dbDir}: ${dirError.message}`);

                // If we can't create the specified directory, fall back to using the current directory
                // console.log(`Falling back to current directory for database`);
                dbPath = './vybe_bot.db';
            }
        }

        // Final check if directory exists and is writable
        const finalDir = path.dirname(dbPath);
        if (finalDir !== '.' && !fs.existsSync(finalDir)) {
            // console.error(`Directory ${finalDir} still doesn't exist, using current directory`);
            dbPath = './vybe_bot.db';
        }

        // console.log(`Final database path: ${dbPath}`);

        // Open the database
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
            // console.log('Added last_processed_block_time column to tracked_wallets table');
        } catch (e) {
            // Column likely already exists
        }

        try {
            await db.exec(`ALTER TABLE tracked_wallets ADD COLUMN tracking_started_at INTEGER;`);
            // console.log('Added tracking_started_at column to tracked_wallets table');
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

        // Table for users who opted out of KOL updates
        await db.exec(`
            CREATE TABLE IF NOT EXISTS kol_update_unsubscriptions (
                user_id INTEGER PRIMARY KEY, -- Telegram User/Chat ID that has opted OUT
                unsubscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(user_id)
            );
        `);

        // Table to store the previous Top N KOL ranking state
        await db.exec(`
            CREATE TABLE IF NOT EXISTS previous_top_kols (
                rank INTEGER PRIMARY KEY, -- e.g., 1 to 10
                owner_address TEXT NOT NULL UNIQUE, -- Ensure address is unique if rank isn't the only key
                name TEXT,
                last_checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // console.log('Database tables checked/created successfully.');
        return db;
    } catch (error) {
        // console.error(`Error initializing database: ${error}`);
        throw error;
    }
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
        // console.error('Error getting all user IDs:', error);
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
        // console.error(`Error initializing token price cache for ${tokenDetails.mint_address}:`, error);
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
        // console.error(`Error getting token price for ${mintAddress}:`, error);
        return null;
    }
}

// Get all token prices from cache
export async function getAllTokenPrices(db: any): Promise<TokenPrice[]> {
    try {
        return await db.all('SELECT * FROM token_prices');
    } catch (error) {
        // console.error('Error getting all token prices:', error);
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
    // console.warn('addPriceHistoryEntry is deprecated - using in-memory storage instead');
    return true;
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
        // console.error(`Error creating price alert for user ${userId} on token ${mintAddress}:`, error);
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
        // console.error(`Error getting price alerts for user ${userId}:`, error);
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
        // console.error(`Error getting price alert ${alertId}:`, error);
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
        // console.error(`Error removing price alert ${alertId} for user ${userId}:`, error);
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
        // console.error(`Error marking alert ${alertId} as triggered:`, error);
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
        // console.error(`Error getting active alerts for token ${mintAddress}:`, error);
        return [];
    }
}

// Add a user to the KOL update unsubscription list
export async function addKolUnsubscription(db: any, userId: number): Promise<boolean> {
    try {
        // Ensure user exists first
        await db.run('INSERT OR IGNORE INTO users (user_id) VALUES (?)', [userId]);
        // Add to unsubscription list
        const result = await db.run(
            'INSERT OR IGNORE INTO kol_update_unsubscriptions (user_id) VALUES (?)',
            [userId]
        );
        return result.changes > 0; // Return true if a new unsubscription was added
    } catch (error) {
        // console.error(`Error adding KOL unsubscription for user ${userId}:`, error);
        throw error; // Re-throw error to be handled by the caller
    }
}

// Get all user IDs who have unsubscribed from KOL updates
export async function getKolUnsubscribedUserIds(db: any): Promise<number[]> {
    try {
        const rows = await db.all('SELECT user_id FROM kol_update_unsubscriptions');
        return rows.map((row: { user_id: number }) => row.user_id);
    } catch (error) {
        // console.error('Error fetching KOL unsubscribed user IDs:', error);
        return [];
    }
}

// Define interface for previous KOL ranking entry
interface PreviousKOL {
    rank: number;
    owner_address: string;
    name: string | null;
    last_checked_at: string;
}

// Get the previously stored top KOLs ranking
export async function getPreviousTopKols(db: any): Promise<PreviousKOL[]> {
    try {
        const rows = await db.all('SELECT rank, owner_address, name, last_checked_at FROM previous_top_kols ORDER BY rank ASC');
        return rows;
    } catch (error) {
        // console.error('Error fetching previous top KOLs:', error);
        return [];
    }
}

// Update the stored top KOLs ranking
// Expects an array of KOL accounts, ordered by rank (index 0 is rank 1)
export async function updatePreviousTopKols(db: any, currentTopKols: KnownAccount[]): Promise<void> {
    try {
        // Use a transaction for atomic update
        await db.exec('BEGIN TRANSACTION');

        // Clear the previous ranking
        await db.exec('DELETE FROM previous_top_kols');

        // Insert the new ranking
        const stmt = await db.prepare(
            'INSERT INTO previous_top_kols (rank, owner_address, name, last_checked_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
        );
        for (let i = 0; i < currentTopKols.length; i++) {
            const kol = currentTopKols[i];
            await stmt.run(i + 1, kol.ownerAddress, kol.name);
        }
        await stmt.finalize();

        // Commit the transaction
        await db.exec('COMMIT');
        // console.log(`Updated previous_top_kols table with ${currentTopKols.length} entries.`);
    } catch (error) {
        // console.error('Error updating previous top KOLs:', error);
        // Rollback transaction on error
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            // console.error('Error rolling back transaction:', rollbackError);
        }
        // Optionally re-throw the original error
        // throw error;
    }
} 