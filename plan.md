# Vybe Telegram Bot - Project Plan

## 1. Project Overview

**Goal:** To build an innovative Telegram bot for the Vybe Hackathon, delivering real-time, on-chain Solana analytics powered by Vybe APIs. The bot aims to provide both personalized tracking/alerts and valuable community-level insights.

**Target Audience:** Primarily active crypto traders, community members (especially those interested in Solana ecosystem tokens, including meme coins), and casual investors seeking quick updates. Engagement and continuous information flow are prioritized.

**Core Concept:** A hybrid Telegram experience combining:
    *   **Private, personalized on-chain monitoring:** Users interact directly with the bot to track wallets/tokens and receive sensitive alerts privately.
    *   **Public, curated community insights:** The bot resides within a Telegram Group (with Topics enabled) to deliver scheduled digests and handle public information requests in dedicated topics.

## 2. Interaction Model (Hybrid Approach)

The bot will operate in two main contexts:

*   **A) Telegram Group (with Topics Enabled):**
    *   **Purpose:** Community hub, general announcements, public data requests.
    *   **Topic: `#VybeDigest`:** The bot will post scheduled, periodic market summaries/digests here (e.g., daily). This topic is primarily for bot broadcasts.
    *   **Topic: `#Bot`:** Users can issue non-sensitive, public commands here (e.g., `/token_info SOL`). The bot will reply publicly *within this topic thread*.
    *   **Other Topics (e.g., `#General`):** For general user discussion; the bot will likely ignore messages here unless specifically mentioned.

*   **B) Direct Message (DM) with the Bot:**
    *   **Purpose:** All private setup, sensitive data viewing, and personalized alert delivery.
    *   **Actions:** Users `/start` the bot here, set up tracking (`/track_token`, `/track_whale`), configure alerts (`/set_alert`), view their personal portfolio (`/portfolio`).
    *   **Alerts:** All personalized alerts (price movements hitting user thresholds, tracked whale activity) are sent *only* via DM to the relevant user.

## 3. Key Features (Minimum Viable Product - MVP)

**Features delivered via Direct Message (Private):**

*   **User Onboarding:** `/start` command.
*   **Token Tracking Setup:** `/track <token_symbol_or_address>` command to add tokens to a user's watchlist.
*   **Whale Wallet Tracking Setup:** `/track_whale <wallet_address>` command to add specific wallets to a user's watchlist.
*   **Personalized Price Alerts:** Background monitoring of tracked tokens; DM alert sent to user if price change exceeds a default or user-set threshold.
*   **Personalized Whale Transfer Alerts:** Background monitoring of tracked whale wallets; DM alert sent to user if a significant transfer (>$X USD value) is detected.
*   **Basic Portfolio View:** `/portfolio <wallet_address>` command (initially for one address) to show top token balances and total value via DM.

**Features delivered via Group Topic: `#Bot` (Public):**

*   **Public Token Info:** `/token_info <token_symbol_or_address>` command replying with basic token stats (price, 24h change, maybe market cap) within the topic.

**Features delivered via Group Topic: `#VybeDigest` (Broadcast):**

*   **Scheduled Market Digest:** Automated daily (or other frequency) post summarizing key market/ecosystem activity (See Content Strategy below).

## 4. Content Strategy (`#VybeDigest` Broadcasts)

*   **Format:** Concise, scannable daily summary. Potential content:
    *   Top 3 Solana Gainers (24h)
    *   Top 3 Solana Losers (24h)
    *   Top 3 Solana Tokens by Volume (24h)
    *   *(Alternatively: Focus on Program Activity - DAU/TVL)*
*   **Tone:** Engaging, informative, potentially meme-aware.
*   **Engagement Hook:** Include links to relevant external resources (e.g., AlphaVybe for details, project X/Twitter accounts). Include a reminder for users to use DM for personal tracking.
*   **Potential Monetization/Growth:** General broadcast messages can be leveraged later for relevant promotions, partnerships, or driving traffic to other platforms, aligned with audience interest.

## 5. Success Metrics (Hackathon Focus)

*   **Innovation:** Unique blend of personalized alerts and community digests using Vybe APIs.
*   **User Experience:** Clear separation between public (topic) and private (DM) interactions; responsiveness.
*   **Technical Execution:** Reliable background monitoring, alert delivery, and API usage.
*   **Documentation:** Clear `README.md` explaining setup and usage.
*   **Commercial Viability:** Potential for user growth and engagement based on the feature set and target audience focus.

## 6. Future Considerations (Post-MVP)

*   Advanced alert customization.
*   Multi-wallet portfolio tracking in DM.
*   Tracking program-specific activity (DeFi protocols).
*   NFT portfolio tracking (if added later).
*   User settings (`/settings`) in DM to manage preferences (e.g., alert thresholds, digest frequency if opt-out is ever needed).
*   More sophisticated public commands in the `#Bot` topic.