# Automated Price & Digest Scheduler Implementation

## Overview
This document outlines the phases for implementing automated price board and digest broadcasts to all users every 4 hours.

## Phase 1: Code Cleanup
1. Remove existing command handlers from `telegram.ts`:
   ```typescript
   // Remove these handlers
   bot.onText(/\/prices/, async (msg: any) => {...});
   bot.onText(/\/testdigest/, async (msg) => {...});
   ```
2. Extract core functionality into reusable functions:
   - `generateAndSendPriceBoard(chatId: number)`
   - `generateAndSendDigest(chatId: number)`

## Phase 2: Scheduler Implementation
1. Create new file `src/scheduler.ts`:
   ```typescript
   import { bot } from './telegram';
   import { generatePriceBoardImage } from './utils/imageGenerator';
   import { getRankedDexData, formatDigestMessage } from './vybeApi';
   import { getAllUserIds } from './database';

   export async function startScheduler(db: any) {
     // Implementation here
   }
   ```

2. Implement core scheduler functions:
   - `sendPriceBoardToAllUsers()`
   - `sendDigestToAllUsers()`
   - Rate limiting and error handling

## Phase 3: Integration
1. Update `src/index.ts`:
   ```typescript
   import { startScheduler } from './scheduler';
   
   // After bot and db initialization
   startScheduler(db);
   ```

2. Add immediate execution on startup
3. Set up 4-hour intervals

## Phase 4: Testing & Monitoring
1. Test with small user set
2. Monitor rate limits
3. Add basic logging
4. Verify error handling

## Implementation Details

### Scheduler Structure
```typescript
// src/scheduler.ts

const FOUR_HOURS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
const SEND_DELAY = 150; // ms between sends

async function sendPriceBoardToAllUsers(db: any) {
  const userIds = await getAllUserIds(db);
  const imageBuffer = await generatePriceBoardImage();
  
  for (const userId of userIds) {
    try {
      await bot.sendPhoto(userId, imageBuffer, {
        caption: 'Latest Solana Token Prices ✨'
      });
      await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
    } catch (error) {
      console.error(`Failed to send price board to user ${userId}:`, error);
    }
  }
}

async function sendDigestToAllUsers(db: any) {
  const userIds = await getAllUserIds(db);
  const rankedData = await getRankedDexData();
  const message = formatDigestMessage(rankedData);
  
  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
    } catch (error) {
      console.error(`Failed to send digest to user ${userId}:`, error);
    }
  }
}

export async function startScheduler(db: any) {
  // Run immediately on startup
  await Promise.all([
    sendPriceBoardToAllUsers(db),
    sendDigestToAllUsers(db)
  ]);

  // Schedule regular runs
  setInterval(() => sendPriceBoardToAllUsers(db), FOUR_HOURS);
  setInterval(() => sendDigestToAllUsers(db), FOUR_HOURS);
}
```

### Error Handling
- Log failed sends
- Continue with next user on error
- No retries for simplicity
- Basic error categorization (blocked, network, etc.)

### Rate Limiting
- 150ms delay between sends
- No batching (for simplicity)
- Single image/digest generation per run

## Future Enhancements (Post-Hackathon)
1. Move to dedicated worker
2. Add user opt-out
3. Implement retry logic
4. Add monitoring metrics
5. Use job queue for large user bases
6. Add timezone support
7. Implement digest customization

## Notes
- Keep it simple for hackathon
- Focus on reliability over features
- Monitor Telegram rate limits
- Consider timezone impact on user experience 