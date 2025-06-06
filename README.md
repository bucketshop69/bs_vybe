# Vybe Telegram Bot (bs_vybe)

**Access the live bot here:** [https://t.me/bs_vybe_bot](https://t.me/bs_vybe_bot)

## 🏛️ Core Architecture

The bot is built with a robust, scalable architecture that leverages worker threads for parallel processing and real-time data handling. Here's the core architecture:

### Worker Thread System
- **WorkerManager**: Central orchestrator managing multiple worker threads
  - Handles worker lifecycle (start, stop, restart)
  - Manages inter-worker communication
  - Implements automatic recovery on failures
  - Supports different worker types:
    - Telegram Bot Worker
    - Token Price Worker
    - Wallet Activity Worker
    - Alert Processing Worker

### Real-time Data Processing
- **VybeWebSocket Service**: Handles real-time data streams
  - Manages WebSocket connections with automatic reconnection
  - Implements filter-based data subscription
  - Handles message routing to appropriate handlers
  - Supports multiple data types (transfers, trades, prices)

### Price Alert System
- **Token Price Service**: Manages token price monitoring
  - Implements smart polling with exponential backoff
  - Maintains price history for trend analysis
  - Handles price target detection
  - Manages alert distribution

### Database Layer
- **Database Service**: Centralized data management
  - Handles user subscriptions
  - Manages tracked wallets
  - Stores price alerts
  - Maintains KOL rankings

### Event System
- **Event Emitter**: Facilitates loose coupling between components
  - Handles price updates
  - Manages wallet activity notifications
  - Routes alert triggers
  - Coordinates worker communication

### Error Handling & Recovery
- Comprehensive error handling across all layers
- Automatic worker recovery
- Graceful degradation
- Detailed error logging

## 🚀 Overview

This Telegram bot provides real-time insights and alerts based on data from the Vybe API, focusing on Solana Key Opinion Leaders (KOLs) and token price movements. It allows users to track top traders, monitor their wallets, and set custom price alerts for specific tokens.

## ✨ Features

*   **KOL Tracking:** View ranked lists of top KOL traders, see their performance metrics (PnL, win rate, volume), view detailed profiles, and track their wallets for trade alerts. Includes periodic updates on ranking changes.
*   **Token Price Alerts:**
    *   Track specific tokens (by symbol or address) for significant price movement alerts.
    *   Set custom price targets (above or below current price) for specific tokens.
    *   View and manage active alerts.
*   **Wallet Tracking:** Track specific Solana wallet addresses (initially focused on KOL wallets, but potentially extensible).
*   **Interactive Interface:** Uses Telegram commands and inline keyboards for navigation (e.g., pagination for KOL lists).
*   **Real-time Data:** Leverages the Vybe API for up-to-date KOL and token information.
*   **Notifications:** Sends alerts directly to users via Telegram for tracked events (price movements, KOL trades, KOL ranking changes).
*   **Automated Insights:** Can generate automated price chart snapshots and KOL activity summaries.

## Automated Broadcasts

The bot automatically sends two types of broadcasts to all users:

1. **Price Board** (Every 4 hours)
   - Shows current prices of tracked tokens
   - Includes price changes and trends
   - Sent as an image for better readability

2. **Market Digest** (Every 12 hours)
   - Comprehensive market overview
   - Top performing tokens
   - Trading volume analysis
   - Sent as a formatted message

Broadcasts start from server initialization time and continue on their respective intervals.

## 🔧 Setup & Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd bs_vybe
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Environment Variables:**
    *   Create a `.env` file in the project root.
    *   Add the required environment variables:
        ```dotenv
        # .env
        VYBE_TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
        VYBE_KEY="YOUR_VYBE_API_KEY"
        # Add any other required variables (e.g., database connection string if applicable)
        ```
    *   Refer to `env-rule` documentation for details. **Never commit the `.env` file.**
4.  **Build the code (if using TypeScript):**
    ```bash
    npm run build
    # or
    yarn build
    ```
5.  **Run the bot:**
    ```bash
    npm start
    # or
    yarn start
    # or directly using node if applicable
    # node dist/index.js
    ```

## 🤖 Commands

### General
*   `/start`: Displays the welcome message and core command overview.
*   `/help`: Shows a detailed list of available commands and their usage.

### KOL Tracking
*   `/kols`: Shows a paginated list of top KOL traders, sorted by trading volume, with performance summaries. Click number commands (e.g., `/1`, `/2`) to view details.
*   `/track_kol`: (After viewing a KOL's detail with `/1`, `/2`, etc.) Starts tracking the viewed KOL's wallet for trade alerts.
*   `/unsubscribe_kol_updates`: Opts out of receiving periodic KOL ranking change notifications.

### Token Price Alerts
*   `/set_alert`: Initiates setting a specific price target alert for a token (enter symbol/address and then target price when prompted).
*   `/my_alerts`: Displays your currently active price target alerts with their status and IDs.
*   `/remove_alert`: Initiates removing a specific price target alert (enter the alert ID when prompted).

### Wallet Tracking (Limited Scope Currently)
*   `/tracked_wallets`: Shows the list of wallets you are currently tracking, distinguishing between KOL and other wallets.
*   `/remove_wallet`: Initiates removing a wallet from your tracked list (enter the wallet address when prompted).
*   `/track_wallet`: (Manual entry) Initiates tracking a specific Solana wallet address (enter the address when prompted). *Note: Primary tracking is intended via `/track_kol`.*

### Other (Testing/Internal)
*   `/testdigest`: Fetches and displays a sample DEX data digest.
*   `/prices`: Generates and displays an image board of Solana token prices.

## 🏛️ Architecture Overview

*   **`src/telegram.ts`:** Main bot logic, handles commands, user interactions, message formatting, and integration with other modules.
*   **`src/vybeApi.ts`:** Interacts with the external Vybe API to fetch KOL and token data.
*   **`src/database.ts`:** Manages database interactions for storing user subscriptions, tracked wallets, alerts, etc. (Specific implementation details depend on the database used).
*   **`src/tokenPriceService.ts`:** Handles fetching and potentially caching token price information.
*   **`src/tokenAlerts.ts`:** Logic for checking and triggering price alerts.
*   **`src/utils/imageGenerator.ts`:** Utility for creating image-based outputs (like price boards).
*   **`.env`:** Stores sensitive configuration like API keys and bot tokens.

## TODO / Future Enhancements

*   Refine wallet tracking beyond KOLs.
*   Expand alert types (e.g., volume changes, new token listings).
*   Add more data visualizations.
*   Implement robust error handling and logging.
*   Consider user configuration options (e.g., alert thresholds). 