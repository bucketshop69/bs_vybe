Okay, let's break down the implementation of the Wallet Tracking via Polling feature into clear, actionable steps for the junior developer, assuming they have the project context from PLAN.md but need specific guidance for this feature.

Task Breakdown: Implement Wallet Transfer Tracking (Polling Method)

(Overall Goal: Allow users to track wallets via DM and receive private alerts for new token transfers involving those wallets, using Vybe API polling.)

Prerequisites:

Basic bot connection (/start command) is working.

SQLite database is set up (database.ts), and the users table exists.

Vybe API client (vybeApi.ts) is set up to handle authentication (VYBE_KEY).

node-cron is installed (npm install node-cron @types/node-cron).

Step 1: Update Database Schema

Goal: Add the necessary table and column to store wallet tracking preferences and the state needed to prevent duplicate alerts.

File: src/database.ts (within the initializeDatabase function or a migration script).

Action:

Ensure the tracked_wallets table exists. If not, add the CREATE TABLE IF NOT EXISTS tracked_wallets command:

CREATE TABLE IF NOT EXISTS tracked_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    label TEXT, -- Optional label user might give later
    last_notified_tx_signature TEXT, -- Stores the signature of the last TX user was alerted about for this address
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Optional: Track updates
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    UNIQUE(user_id, wallet_address) -- Prevent tracking the same wallet multiple times per user
);


(If the table exists but lacks the column): Add an ALTER TABLE tracked_wallets ADD COLUMN last_notified_tx_signature TEXT; command (ensure it handles existing tables correctly).

Why: We need to store which user tracks which wallet, and crucially, the signature of the last transaction they were notified about to avoid sending repeat alerts.

Step 2: Implement /track_wallet Command

Goal: Allow users to add a wallet to their tracking list via DM.

File: Main bot file (e.g., index.ts).

Action:

Create a command handler: bot.onText(/\/track_wallet (.+)/, async (msg, match) => { ... });

Inside the handler:

Get userId from msg.chat.id.

Get walletAddress from match[1].

Validate walletAddress: Basic check if it looks like a Solana address (e.g., check length, base58 characters). Respond with an error message if invalid.

Database Interaction:

Create a function addTrackedWallet(userId, walletAddress) in database.ts. This function should execute:

INSERT INTO tracked_wallets (user_id, wallet_address, last_notified_tx_signature)
VALUES (?, ?, NULL)
ON CONFLICT(user_id, wallet_address) DO NOTHING;
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
SQL
IGNORE_WHEN_COPYING_END

(Using ON CONFLICT DO NOTHING handles cases where the user tries to track the same wallet again gracefully. last_notified_tx_signature starts as NULL).

Call addTrackedWallet(userId, walletAddress). Handle potential database errors.

Response: Send a confirmation message back to the user's DM: ✅ Now tracking wallet \${walletAddress}` for new transfers. You'll get alerts here.`

Why: This allows users to register their interest in a wallet and sets up the initial tracking state in the DB.

Step 3: Implement Vybe API Call for Transfers

Goal: Create a function to fetch the most recent token transfers involving a specific wallet address.

File: src/vybeApi.ts

Action:

Create an async function: async function getRecentTransfersForWallet(walletAddress: string, limit: number = 5): Promise<VybeTransfer[] | null> (Define VybeTransfer interface based on expected API response fields like signature, blockTime, senderAddress, receiverAddress).

Inside the function:

Call axios.get('https://api.vybenetwork.xyz/token/transfers', { ... }).

Include headers with X-API-KEY.

Include params: { walletAddress: walletAddress, limit: limit, sortByDesc: 'blockTime' }.

Use try...catch to handle API errors (log error, return null).

If successful, return the data array from the response (which should contain the transfer objects).

Why: This function isolates the specific API call needed by the polling job.

Step 4: Implement the Polling Logic

Goal: Periodically check for new transfers for all tracked wallets and trigger notifications.

File: src/pollingService.ts (or main file).

Action:

Get Wallets & State: Create a function getAllTrackedWalletsWithState() in database.ts that returns a list of objects like { userId: number, walletAddress: string, lastNotifiedTxSignature: string | null }. Fetch all rows from tracked_wallets.

Polling Job Setup: Use node-cron to schedule a function checkWalletActivity() to run every ~60 seconds.

checkWalletActivity() Function:

Fetch all tracked wallet states using getAllTrackedWalletsWithState(). Group them by walletAddress for efficiency (Map<string, {userId, lastSig}[]>).

Loop through each unique walletAddress in the map.

Inside the loop:

Call getRecentTransfersForWallet(walletAddress) from vybeApi.ts.

If transfers are returned: Iterate through the transfers array (newest first).

For each transfer:

Get the list of users tracking this walletAddress from your map.

For each user in that list:

Compare transfer.signature with user.lastNotifiedTxSignature.

If transfer.signature is different:

Notify: Format the alert message with the Solscan link. Send it via DM to user.userId (Need access to the bot instance or a dedicated send function).

Update DB: Call a new function updateLastNotifiedSignature(userId, walletAddress, transfer.signature) in database.ts to update the specific row.

If transfer.signature matches: Break the inner loop (stop checking older transfers for this user).

(Optional Delay): Add a small await delay(ms) between processing each walletAddress if you track many wallets, to avoid hitting API rate limits.

Why: This is the core engine that detects new activity and triggers the necessary actions (alerting, state update).

Step 5: Database Update Function

Goal: Create the function to update the notification state in the database.

File: src/database.ts

Action:

Create an async function updateLastNotifiedSignature(userId: number, walletAddress: string, signature: string).

Execute the SQL command:

UPDATE tracked_wallets
SET last_notified_tx_signature = ?, updated_at = CURRENT_TIMESTAMP
WHERE user_id = ? AND wallet_address = ?;
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
SQL
IGNORE_WHEN_COPYING_END

Pass signature, userId, and walletAddress as parameters. Handle potential errors.

Why: Essential for preventing duplicate alerts.

How to Test:

Start the bot.

Use /track_wallet <YOUR_TEST_WALLET> in DM. Verify the confirmation message. Check the database tracked_wallets table.

Manually trigger the checkWalletActivity() function (or wait for the cron job).

Perform a token transfer involving your <YOUR_TEST_WALLET>.

Observe the bot's logs. Check if the polling job detects the new transfer.

Verify you receive the alert message via DM.

Check the database again – the last_notified_tx_signature for your user/wallet pair should now contain the signature of the transfer you just made.

Trigger checkWalletActivity() again. Verify you do not receive a duplicate alert for the same transaction.

This step-by-step process breaks the feature down into manageable database, API, logic, and scheduling components.