# Vybe Telegram Bot Architecture

## Overview
The Vybe Telegram Bot is a Node.js application that provides Solana wallet tracking, token price alerts, and Vybe Network data integration through a Telegram interface. The bot allows users to track wallet transactions, monitor token prices, and receive notifications about activity.

## Core Components

### 1. Database Structure
The application uses SQLite with the following schema:

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Tracked wallets table
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

-- Token price cache table
CREATE TABLE IF NOT EXISTS token_prices (
    mint_address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    current_price REAL,
    last_update_time INTEGER,  -- Unix timestamp
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- User specific price alerts
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

-- Global subscriptions for general price movement alerts
CREATE TABLE IF NOT EXISTS token_alert_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    UNIQUE(user_id, mint_address)
)
```

### 2. In-Memory Storage
In addition to the database, the application uses in-memory storage for:

```typescript
// In-memory price history with bounded size (last 60 minutes)
const tokenPriceHistory: {
    [mintAddress: string]: Array<{price: number, timestamp: number}>
} = {};
```

This storage provides efficient access to recent price data for:
- Calculating short-term price changes
- Detecting price patterns
- Determining if alerts should be triggered

### 3. File Structure
```
src/
├── index.ts              (Main application entry point)
├── database.ts           (Database initialization and CRUD operations)
├── telegram.ts           (Telegram bot setup and command handling)
├── vybeApi.ts            (API client for Vybe Network)
├── pollingService.ts     (Service for polling wallet activity)
├── tokenPriceService.ts  (Service for polling token prices and detecting changes)
├── tokenAlerts.ts        (Alert processing and notification system)
├── logger.ts             (Logging utilities)
├── config.ts             (Configuration constants)
```

### 4. Environment Variables
The application uses the following environment variables:
- `VYBE_TELEGRAM_BOT_TOKEN`: The Telegram bot token from BotFather
- `VYBE_KEY`: API key for Vybe Network API access
- `TELEGRAM_CHAT_ID`: ID of the chat for sending messages
- `TELEGRAM_GROUP_ID`: (Optional) ID of the group for public alerts and digests
- `VYBE_DIGEST_TOPIC_ID`: (Optional) ID of the topic within the group for digests
- `ADMIN_CHAT_ID`: (Optional) Telegram chat ID of the administrator

### 5. Bot Commands
The bot currently supports the following commands:

- `/start` or `/help`: Initialize the bot and display welcome message
- `/track_wallet <address>`: Start tracking a Solana wallet address
- `/my_wallets`: List all wallets being tracked by the user
- `/remove_wallet <address>`: Stop tracking a specific wallet
- `/track_token <symbol/address>`: Track a token for price movement alerts
- `/set_alert <symbol/address> <targetPrice>`: Set a specific price target alert
- `/my_alerts`: View your active price alerts
- `/remove_alert <id>`: Remove a specific price alert
- `/testdigest`: Generate and send a test DEX data digest

### 6. Key Services

#### Wallet Tracking
- Users can track up to 5 wallets per user
- The system polls for new transactions on tracked wallets
- Notifications are sent when new transactions are detected

#### Token Price Alerts
- Two types of alerts: general movements and specific price targets
- General alerts trigger when price changes by a configured percentage (default 3%)
- Price target alerts trigger when a specific price is reached
- Users can track multiple tokens (configurable limit)
- Price history is stored in-memory with a fixed retention period (last 60 minutes)
- Advanced detection for price patterns (reversals, accelerations)
- Notification throttling to prevent spam

#### Vybe Network Integration
- Fetches DEX data for digest generation
- Retrieves token transfer information
- Provides token details for transactions
- Fetches token price data

#### Polling Services
- Wallet Service: Periodically checks for wallet activity
- Token Price Service: Periodically polls for token price updates
- Both manage notification state to prevent duplicate alerts
- Error handling with exponential backoff

### 7. Security Measures
- Environment variables for sensitive credentials
- Input validation for wallet addresses and token inputs
- Rate limiting on API calls
- Error handling and graceful degradation
- Message throttling to prevent notification spam

## Data Flow

1. User issues a command to the Telegram bot
2. Bot validates the command and updates the database
3. Polling services periodically check for:
   - Wallet activity changes
   - Token price movements
   - Target price crossings
4. When activity is detected, notifications are sent to users
5. Scheduled digests are posted to configured topics

## Limitations

- Maximum of 5 wallets tracked per user
- Configurable limit on token alerts per user
- In-memory price history limited to last 60 minutes
- Polling interval limitations based on API rate limits
- Focus on Solana blockchain only
