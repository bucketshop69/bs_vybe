# Vybe Telegram Bot (bs_vybe)

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
*   **Image Generation:** Can generate images (e.g., price boards - currently via `/prices`).

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
*   `/track_token`: Initiates tracking a token (enter symbol or address when prompted) for significant price movement alerts.
*   `/set_alert`: Initiates setting a specific price target alert for a token (enter symbol/address and then target price when prompted).
*   `/my_alerts`: Displays your currently active price target alerts with their status and IDs.
*   `/remove_alert`: Initiates removing a specific price target alert (enter the alert ID when prompted).

### Wallet Tracking (Limited Scope Currently)
*   `/tracked_wallets`: Shows the list of wallets you are currently tracking, distinguishing between KOL and other wallets.
*   `/remove_wallet`: Initiates removing a wallet from your tracked list (enter the wallet address when prompted).
*   `/track_wallet`: (Manual entry) Initiates tracking a specific Solana wallet address (enter the address when prompted). *Note: Primary tracking is intended via `/track_kol`.*

### Other
*   `/testdigest`: (For Testing) Fetches and displays a sample DEX data digest.
*   `/prices`: (For Testing/Showcase) Generates and displays an image board of Solana token prices.

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