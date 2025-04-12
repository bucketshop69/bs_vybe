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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id),
            UNIQUE(user_id, wallet_address)
        )
    `);

    return db;
}

// Add a new wallet to track
export async function addTrackedWallet(db: any, userId: number, walletAddress: string) {
    // First ensure user exists
    await db.run(
        'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
        [userId]
    );

    // Then add the wallet
    await db.run(
        `INSERT INTO tracked_wallets (user_id, wallet_address, last_notified_tx_signature)
         VALUES (?, ?, NULL)
         ON CONFLICT(user_id, wallet_address) DO NOTHING`,
        [userId, walletAddress]
    );

    // Log that the wallet is now being tracked
    walletLog(walletAddress, userId, 'Wallet tracking started', {
        tracked_at: new Date().toISOString(),
        last_notified_tx_signature: null
    });
}

// Get all tracked wallets with their last notified transaction signature
export async function getAllTrackedWalletsWithState(db: any) {
    return await db.all(`
        SELECT user_id, wallet_address, last_notified_tx_signature, created_at
        FROM tracked_wallets
    `);
}

// Update the last notified transaction signature for a wallet
export async function updateLastNotifiedSignature(
    db: any,
    userId: number,
    walletAddress: string,
    signature: string
) {
    await db.run(
        `UPDATE tracked_wallets
         SET last_notified_tx_signature = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND wallet_address = ?`,
        [signature, userId, walletAddress]
    );
} 