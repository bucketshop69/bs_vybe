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