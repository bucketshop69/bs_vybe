# Token Price Alert Implementation Plan

This document outlines the step-by-step implementation plan for adding token price alerts to the Vybe Telegram Bot.

## Overview

The token price alert feature will allow users to:
1. Track tokens for general price movements (3% changes)
2. Set specific price targets for tokens and receive alerts when those targets are reached

## Implementation Steps

### Phase 1: Database Setup

**Step 1.1: Token Configuration**
- We've added the predefined list of tracked tokens in `config.ts`:
```typescript
// Token tracking configuration - mint addresses of tokens to track
export const TRACKED_TOKENS = [
    '11111111111111111111111111111111',       // SOL
    '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    'LAYER4xPpTCb3QL8S9u41EAhAX7mhBn8Q6xMTwY2Yzc',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS'
];

// Price alert configuration
export const PRICE_ALERT_CONFIG = {
    pollingIntervalMs: 60 * 1000,           // 1 minute in milliseconds
    generalAlertThresholdPercent: 3,        // 3% change triggers general alert
    maxAlertsPerUser: 5,                    // Maximum 5 alerts per user
    tooCloseThresholdPercent: 2,            // Target within 2% of current price is too close
    tooFarThresholdPercent: 10              // Target more than 10% from current price is too far
};
```

**Step 1.2: Create Database Tables**
```sql
-- Token price cache table (stores current prices for faster access)
CREATE TABLE IF NOT EXISTS token_prices (
    mint_address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    current_price REAL,
    last_update_time INTEGER,  -- Unix timestamp
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Price history for tracked tokens
CREATE TABLE IF NOT EXISTS token_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint_address TEXT NOT NULL,
    price REAL NOT NULL,
    timestamp INTEGER NOT NULL,  -- Unix timestamp
    FOREIGN KEY(mint_address) REFERENCES token_prices(mint_address)
);

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
);

-- Global subscriptions for general price movement alerts
CREATE TABLE IF NOT EXISTS token_alert_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    UNIQUE(user_id, mint_address)
);
```

**Step 1.3: Add Database Helper Functions**
- Update `database.ts` with functions to:
  - Initialize token price cache for tokens in TRACKED_TOKENS
  - Add/update/remove user alerts
  - Get user alerts
  - Update token prices
  - Store price history

### Phase 2: Vybe API Integration

**Step 2.1: Create Token API Functions**
- Update `vybeApi.ts` to add functions for:
  - Fetching token price data from the configured list in TRACKED_TOKENS
  - Error handling for API failures
  - Rate limiting implementation

**Step 2.2: Test API Integration**
- Create a test script to verify token price retrieval
- Validate token data structure
- Test error handling

### Phase 3: Price Polling Service 

**Step 3.1: Create Token Price Service**
- Create new file `tokenPriceService.ts`
- Implement polling mechanism for token prices using TRACKED_TOKENS config
- Store historical price data
- Use the polling interval from PRICE_ALERT_CONFIG.pollingIntervalMs

**Step 3.2: Implement Price Change Detection**
- Add logic to detect significant price changes
- Use threshold from PRICE_ALERT_CONFIG.generalAlertThresholdPercent

### Phase 4: Alert Processing System

**Step 4.1: Create Alert Processing Logic**
- Create new file `tokenAlerts.ts`
- Implement matching logic for price targets
- Add logic for detecting general price movements

**Step 4.2: Build Notification System**
- Create message templates for different alert types
- Implement user notification delivery
- Handle rate limiting for notifications

### Phase 5: Bot Commands

**Step 5.1: Add Token Tracking Commands**
- Update `telegram.ts` to handle new commands:
  - `/track_token <mintAddress>` - Subscribe to token price movements
  - `/set_alert <mintAddress> <targetPrice>` - Set specific price target

**Step 5.2: Add Alert Management Commands**
- Add commands:
  - `/my_alerts` - List user's active alerts
  - `/remove_alert <id>` - Remove a specific alert

**Step 5.3: Update Help/Start Commands**
- Update `/start` and help text to include token commands

### Phase 6: Integration & Testing

**Step 6.1: Connect Components**
- Update `index.ts` to start token price service
- Wire up all components

**Step 6.2: Testing**
- Test with various price scenarios
- Verify alert triggers
- Test command handling
- Validate notification delivery

**Step 6.3: Error Handling & Edge Cases**
- Implement graceful error handling
- Add logging for debugging
- Handle edge cases:
  - API failures
  - Price data gaps
  - Invalid user inputs

### Phase 7: Optimization & Refinement

**Step 7.1: Optimize Polling Frequency**
- Fine-tune polling intervals based on token volatility
- Implement backoff strategies for API failures

**Step 7.2: Add Performance Monitoring**
- Track alert processing times
- Monitor database performance

**Step 7.3: User Experience Improvements**
- Refine message formats
- Add confirmation messages
- Improve error messages

## Detailed Command Specifications

### `/track_token <mintAddress>`
- **Purpose**: Subscribe to general price movement alerts for a token
- **Validation**:
  - Verify mintAddress is in the TRACKED_TOKENS list
  - Limit number of tokens tracked per user (as per PRICE_ALERT_CONFIG.maxAlertsPerUser)
- **Response**: Confirmation message with current token price

### `/set_alert <mintAddress> <targetPrice>`
- **Purpose**: Set specific price target alert
- **Validation**:
  - Verify mintAddress is in the TRACKED_TOKENS list
  - Check if price is reasonable compared to current price using PRICE_ALERT_CONFIG thresholds
  - Limit number of alerts per user as per config
- **Response**: Confirmation with alert details and ETA if possible

### `/my_alerts`
- **Purpose**: Show all active user alerts
- **Output**: List of alerts with current prices and targets
- **Options**: None

### `/remove_alert <id>`
- **Purpose**: Remove specific alert
- **Validation**: Verify alert belongs to user
- **Response**: Confirmation of removal

## Configuration Parameters

- **Price polling interval**: 5-15 minutes (configurable)
- **General alert threshold**: 3-5% price change
- **Maximum alerts per user**: 10
- **"Too close" threshold**: 1-2% from target price
- **"Too far" threshold**: >50% from current price
