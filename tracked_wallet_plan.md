# Tracked Wallet Optimization Plan

## Overview
This document outlines the phases for optimizing the wallet tracking system to achieve near real-time notifications by leveraging the Helius RPC endpoint.

## Phases

### Phase 1: Lightweight Polling with Solana RPC (Signature-Driven)
- **Objective:** Reduce API load and simplify logic by using the Helius RPC node as the source of truth for new wallet activity.
- **Implementation:**
  - Use the Helius RPC endpoint: `https://mainnet.helius-rpc.com/?api-key=dbf616dd-1870-4cdb-a0d2-754ae58a64f0`
  - Poll for the latest signature using `getSignaturesForAddress`.
  - Store the latest signature from the RPC in the database for each tracked wallet/user (e.g., `last_polled_signature`).
  - On each poll, compare the latest RPC signature to the stored one. Only if it is different, proceed to the next phase.

### Phase 2: Conditional Full Transfer Fetch (On Signature Change)
- **Objective:** Only fetch full transfer details when a new signature is detected by the RPC.
- **Implementation:**
  - If a new signature is found (i.e., different from the stored one), call the Vybe API to get full transfer details.
  - Process and notify users as before.
  - After notification, update the stored signature to the latest from the RPC.

### Phase 1.5: Spam Address Filtering
- **Objective:** Filter out known spam addresses from wallet activity notifications.
- **Implementation:**
  - Maintain a list of spam addresses in `src/constants.ts`:
    - `FLiPgGTXtBtEJoytikaywvWgbz5a56DdHKZU72HSYMFF`
    - `FLiPGqowc82LLR173hKiFYBq2fCxLZEST5iHbHwj8xKb`
    - `5Hr7wZg7oBpVhH5nngRqzr5W7ZFUfCsfEhbziZJak7fr`
  - Filter out transactions involving these addresses before notifying users.
  - Only notify on actual (non-spam) transactions (e.g., the 4th transaction in the provided image).

### Phase 3: Monitoring and Optimization
- **Objective:** Monitor the performance and optimize the polling interval.
- **Implementation:**
  - Adjust the polling interval based on the number of active wallets and API rate limits.
  - Implement logging to track the frequency of new signatures and API calls.

### Phase 4: Scalability and Error Handling
- **Objective:** Ensure the system can handle a growing number of tracked wallets.
- **Implementation:**
  - Implement concurrency limits for parallel processing of wallets.
  - Add robust error handling and retry mechanisms for API calls.

## Next Steps
- Review and approve the plan.
- Begin implementation of Phase 1.
- Monitor performance and adjust as needed. 