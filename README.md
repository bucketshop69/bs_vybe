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

## Token Price Alerts: Multi-Step Command Flows

The following commands now use a user-friendly, multi-step interaction flow:

### Track a Token
- **Command:** `/track_token`
- **Description:** Initiates the process to track a token for price alerts. The bot will prompt you to enter the token symbol or address (e.g., `SOL` or a token address).
- **Flow:**
  1. User types `/track_token`
  2. Bot prompts: "Please enter the token symbol or address you want to track."
  3. User replies with the symbol/address
  4. Bot confirms and sets up tracking

### Set a Price Alert
- **Command:** `/set_alert`
- **Description:** Initiates the process to set a price target alert for a token. The bot will prompt you for the token symbol/address, then for the target price.
- **Flow:**
  1. User types `/set_alert`
  2. Bot prompts: "Please enter the token symbol or address for your price alert."
  3. User replies with the symbol/address
  4. Bot prompts: "Please enter your target price for the alert."
  5. User replies with the price
  6. Bot confirms and sets the alert

### Remove a Price Alert
- **Command:** `/remove_alert`
- **Description:** Initiates the process to remove a price alert. The bot will prompt you for the alert ID.
- **Flow:**
  1. User types `/remove_alert`
  2. Bot prompts: "Please enter the ID of the alert you want to remove."
  3. User replies with the alert ID
  4. Bot confirms removal

**Note:**
- These multi-step flows improve user experience by guiding you through each step, reducing errors and making the bot easier to use.
- You can always use `/my_alerts` to view your current alerts and their IDs.