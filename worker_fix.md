# Worker Debugging: Price Alert Investigation

## Initial Findings & Potential Issues (Based on `src/index.ts`)

*   **Startup Sequence:** The main application (`src/index.ts`) correctly appears to initiate the `TokenPriceWorker`, initialize prices, and start the service via the `WorkerManager`.
*   **Event Listeners:** Listeners (`setupPriceUpdateListener`, `setupPriceAlertListener`) are set up in `index.ts`, but they currently only log to the console. The actual alert notification logic (e.g., sending a Telegram message) is not present in these handlers and must reside elsewhere (potentially within the Telegram worker triggered by an event, or within the `WorkerManager`).
*   **Worker Implementation (`TokenPriceWorker`):** This is a primary area of concern. Issues could include:
    *   Failure to fetch price data (API errors, configuration issues like missing `VYBE_KEY` in the worker's environment).
    *   Incorrect logic for price comparison or alert condition detection.
    *   Failure to emit the necessary events (`priceAlert`, `priceUpdate`) back to the `WorkerManager` via `parentPort.postMessage`.
*   **Worker Communication (`WorkerManager`):** The manager acts as the bridge. Potential issues:
    *   Not correctly listening for messages/events from `TokenPriceWorker`.
    *   Not correctly emitting events (`WorkerManagerEvent.PRICE_ALERT`, `WorkerManagerEvent.PRICE_UPDATE`) for the main thread listeners to catch. Mismatched event names or faulty relay logic.
*   **Configuration:** Ensuring sensitive keys (`VYBE_KEY`) and other necessary configs are accessible within the worker thread's `process.env`.

## Action Plan

### Phase 1: Verify Event Flow & Basic Worker Functionality

1.  **Check Console Logs:** Run the application and carefully monitor the console output.
    *   **Goal:** Determine if the `console.log` messages within `setupPriceUpdateListener` and `setupPriceAlertListener` in `src/index.ts` are appearing.
    *   **If Yes:** Proceed to Phase 2 (Alert Logic).
    *   **If No:** Proceed to Step 2 (Worker Internals).
2.  **Examine `TokenPriceWorker` Logs:** Add detailed logging inside the `TokenPriceWorker` file.
    *   Log successful/failed API calls for price fetching.
    *   Log the price data received.
    *   Log when the comparison logic runs and the outcome.
    *   Log *right before* `parentPort.postMessage` is called to signal an update or alert.
    *   **Goal:** Pinpoint where the process fails *within* the worker (fetching, comparing, or emitting).
3.  **Examine `WorkerManager` Logs:** Add logging within `WorkerManager` where it handles messages received from `TokenPriceWorker` and where it emits events to the main thread.
    *   **Goal:** Ensure messages from the worker are received and that the manager attempts to emit the corresponding `WorkerManagerEvent`. Check for event name mismatches.

### Phase 2: Investigate Alert Logic & Notification

*This phase assumes Phase 1 confirmed that `priceAlert` events are being received by the main thread's listener.*

1.  **Trace the Alert:** Identify where the application *should* react to the `priceAlert` event (or the data logged by the listener) to send a notification (e.g., to Telegram).
    *   Is it handled by the `TelegramBotWorker`?
    *   Is there a separate `AlertProcessingWorker` (mentioned as planned in `index.ts`)?
    *   Is the `WorkerManager` supposed to orchestrate this?
2.  **Debug the Notification Mechanism:** Examine the code responsible for sending the alert. Check for:
    *   Correct API tokens/keys for the notification service (e.g., `VYBE_TELEGRAM_BOT_TOKEN`).
    *   Correct function calls and parameters.
    *   Error handling around the notification sending process.

### Phase 3: Configuration Verification

*This should be checked alongside Phases 1 & 2 if configuration issues are suspected.*

1.  **Worker Environment:** Verify how environment variables (`VYBE_KEY`, `VYBE_TELEGRAM_BOT_TOKEN`) are passed to or made available within each worker thread. Ensure they are accessible via `process.env` *inside* the relevant worker.
2.  **.env File:** Double-check the `.env` file for correct variable names and values.

## Next Steps

*   Execute Phase 1, starting with checking the console logs from the existing listeners in `src/index.ts`.
*   Based on the results, proceed to examine the `TokenPriceWorker` or `WorkerManager` code and add more specific logging as needed. 