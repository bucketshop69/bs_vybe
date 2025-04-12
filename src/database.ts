import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { walletLog } from './logger';

// Initialize the database and create necessary tables
export async function initializeDatabase() {
    const db = await open({
        filename: './vybe_bot.db',
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