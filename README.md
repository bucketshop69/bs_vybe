# bs_vybe

## Command: /track_wallet

The `/track_wallet` command allows you to track Solana wallet addresses for new transfer activity. Below are the related commands and their usage:

### Track a Wallet
- **Command:** `/track_wallet`
- **Description:** Initiates the process to track a new Solana wallet address. The bot will prompt you to paste the wallet address you want to track.
- **Validation:** The address must be a valid 44-character Solana base58 address.
- **Limit:** You can track up to 5 wallets per user.

### View Tracked Wallets
- **Command:** `/my_wallets`
- **Description:** Lists all Solana wallets you are currently tracking, including the date tracking started and any labels.

### Remove a Tracked Wallet
- **Command:** `/remove_wallet`
- **Description:** Initiates the process to stop tracking a wallet. The bot will prompt you to paste the wallet address you want to remove from tracking.

**Note:**
- You will receive notifications for new transfers on any wallet you are tracking (excluding spam addresses).
- Use these commands to manage your tracked wallets efficiently.

## Token Price Alerts

This bot offers two types of token price alerts:

1.  **User-Set Target Alerts:** You can set specific price targets for tokens you are interested in.
2.  **Automatic General Alerts:** The bot monitors a predefined list of globally tracked tokens for significant price movements.

### User-Set Target Alerts: Multi-Step Commands

The following commands allow you to manage your personal price target alerts using a user-friendly, multi-step interaction flow:

#### Track a Token (Optional Subscription)
- **Command:** `/track_token`
- **Description:** Previously used to track tokens, this command might be repurposed or removed as general alerts are now global. *Note: This command's current functionality might differ from this description based on implementation details.*
- **Flow:**
  1. User types `/track_token`
  2. Bot prompts: "Please enter the token symbol or address you want to track."
  3. User replies with the symbol/address
  4. Bot confirms and sets up tracking

#### Set a Price Alert
- **Command:** `/set_alert`
- **Description:** Initiates the process to set a specific price target alert for *any* token (not just globally tracked ones). The bot will prompt you for the token symbol/address, then for the target price.
- **Flow:**
  1. User types `/set_alert`
  2. Bot prompts: "Please enter the token symbol or address for your price alert."
  3. User replies with the symbol/address
  4. Bot prompts: "Please enter your target price for the alert."
  5. User replies with the price
  6. Bot confirms and sets the alert

#### View Your Alerts
- **Command:** `/my_alerts`
- **Description:** Lists all your active *user-set price target alerts* and their IDs.

#### Remove a Price Alert
- **Command:** `/remove_alert`
- **Description:** Initiates the process to remove a price alert. The bot will prompt you for the alert ID.
- **Flow:**
  1. User types `/remove_alert`
  2. Bot prompts: "Please enter the ID of the alert you want to remove."
  3. User replies with the alert ID
  4. Bot confirms removal

### Automatic General Price Movement Alerts

- **Description:** The bot automatically monitors a predefined list of important tokens (e.g., SOL, JUP, BONK, etc., defined in the bot's configuration).
- **Trigger:** An alert is triggered when one of these tracked tokens experiences a price change exceeding a configured percentage threshold (e.g., +/- 3%) within the polling interval.
- **Recipients:** These general alerts are broadcast to **all registered users** of the bot.
- **Noise Reduction:** To avoid excessive notifications, the bot uses intelligent logic. Once an alert is sent for a token crossing the threshold in a specific direction (up or down), further alerts for that same direction are suppressed until the price moves back within the threshold or reverses direction significantly.

**Note:**
- User-set alerts (`/set_alert`) are personal and only notify you.
- General alerts are automatic broadcasts about significant moves in globally tracked tokens.

## Deployment

### Deploying to Render (Free Tier)

This bot can be easily deployed to Render.com's free tier:

1. Fork or push this repository to your GitHub account.

2. Sign up for a free account on [Render](https://render.com) and connect your GitHub account.

3. **IMPORTANT**: Add a persistent disk BEFORE creating the service:
   - In your Render dashboard, go to "Disks" in the left sidebar and create a new disk
   - Name: `data`
   - Mount Path: `/data`
   - Size: 1 GB (minimum)

4. Create a new Web Service:
   - Select your repository
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Select the Free plan
   - Root Directory: `/` (the repository root)

5. Add the following environment variables:
   - `VYBE_TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
   - `VYBE_KEY`: Your API key for Vybe Network
   - `DATABASE_PATH`: `/data/vybe_bot.db`

6. Under "Advanced" settings, attach the disk you created in step 3 to this service.

7. Click "Create Web Service" to deploy.

**Troubleshooting**:
- If you see a `SQLITE_CANTOPEN` error, ensure you've created and attached the disk properly.
- Free Render services "spin down" after inactivity, which may cause a slight delay on the first interaction.
- The database file will be stored on the persistent disk to ensure data is preserved between deployments.
- Render will automatically redeploy when you push changes to your repository.
