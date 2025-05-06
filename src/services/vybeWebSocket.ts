import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

// --- Type Definitions (Phase 1.5) ---

// Basic filter structure - will be expanded in Phase 2
interface VybeBaseFilter {
    // Define common filter properties if any, or leave empty
}

export interface VybeTransferFilter extends VybeBaseFilter {
    senderAddress?: string;
    receiverAddress?: string;
    feePayer?: string;
    minAmount?: number;
    maxAmount?: number;
    programId?: string;
    tokenMintAddress?: string;
}

export interface VybeTradeFilter extends VybeBaseFilter {
    feePayer?: string;
    authorityAddress?: string;
    marketId?: string;
    programId?: string;
    tokenMintAddress?: string;
}

export interface VybeOraclePriceFilter extends VybeBaseFilter {
    priceFeedAccount?: string;
    productAccount?: string;
}

export interface VybeWebSocketFilters {
    transfers?: VybeTransferFilter[];
    trades?: VybeTradeFilter[];
    oraclePrices?: VybeOraclePriceFilter[];
}

// --- WebSocket Service ---

const VYBE_WEBSOCKET_URI = "wss://api.vybenetwork.xyz/live";
const RECONNECT_DELAY_MS = 5000;
const ENABLE_RECONNECT = true;

type MessageHandler = (message: any) => void;

class VybeWebSocketService {
    private ws: WebSocket | null = null;
    private apiKey: string | null = null;
    private currentFilters: VybeWebSocketFilters | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private messageHandlers: MessageHandler[] = [];
    private isConnecting: boolean = false; // Prevent multiple connection attempts

    /**
     * Initialize the service with the required API key.
     * Reads from process.env.VYBE_KEY if not provided.
     */
    public initialize(apiKey?: string): void {
        this.apiKey = apiKey ?? process.env.VYBE_KEY ?? null; // Use ?? to handle undefined correctly
        if (!this.apiKey) {
            console.error("ERROR: VYBE_KEY is missing. Provide it during initialization or set in .env");
            // Consider throwing an error or setting a state that prevents connection
        } else {
            console.log("VybeWebSocketService initialized.");
        }
    }

    /**
     * Register a handler function to receive messages.
     */
    public onMessageHandler(handler: MessageHandler): void {
        this.messageHandlers.push(handler);
    }

    /**
     * Connect to the Vybe WebSocket API and apply filters.
     */
    public startWebSocket(filters: VybeWebSocketFilters): void {
        if (!this.apiKey) {
            console.error("ERROR: Cannot start WebSocket. Service not initialized or VYBE_KEY missing.");
            return;
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.warn("WebSocket already connected. To change filters, stop and restart.");
            return;
        }
        if (this.isConnecting) {
            console.warn("WebSocket connection attempt already in progress.");
            return;
        }

        this.currentFilters = filters;
        console.log(`Attempting to connect to ${VYBE_WEBSOCKET_URI}...`);
        this.connect();
    }

    /**
     * Disconnect the WebSocket connection cleanly.
     */
    public stopWebSocket(): void {
        console.log("Stopping WebSocket connection...");
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners(); // Clean up listeners
            this.ws.close(1000, "Client initiated disconnect"); // Use code 1000 for normal closure
            this.ws = null;
        }
        this.isConnecting = false; // Reset connecting flag
        console.log("WebSocket stopped.");
    }

    // --- Private Methods ---

    private getTimestamp(): number {
        return Math.floor(Date.now() / 1000);
    }

    private connect(): void {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            console.log("Connect called but already connecting or connected.");
            return;
        }

        if (!this.apiKey) {
            console.error("Internal Error: connect() called without API key.");
            return; // Should not happen if startWebSocket checks correctly
        }

        this.isConnecting = true;

        // Clean up any existing listeners before creating a new instance
        if (this.ws) {
            this.ws.removeAllListeners();
        }

        try {
            this.ws = new WebSocket(VYBE_WEBSOCKET_URI, {
                headers: {
                    "X-API-Key": this.apiKey,
                },
            });

            this.ws.on("open", this.onOpen.bind(this));
            this.ws.on("message", this.onMessage.bind(this));
            this.ws.on("close", this.onClose.bind(this));
            this.ws.on("error", this.onError.bind(this));

        } catch (error) {
            console.error(`Failed to create WebSocket instance: ${error}`);
            this.isConnecting = false;
            this.attemptReconnect(); // Still attempt reconnect on creation error
        }
    }

    private sendConfiguration(filters: VybeWebSocketFilters): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const configureMessage = JSON.stringify({
                type: "configure",
                filters: filters,
            });
            console.log("Sending configuration message:", JSON.stringify(filters));
            this.ws.send(configureMessage);
        } else {
            console.error("Cannot send configuration, WebSocket is not open.");
        }
    }

    private attemptReconnect(): void {
        if (!ENABLE_RECONNECT) {
            console.log("Reconnect disabled.");
            return;
        }
        if (this.reconnectTimeout) {
            console.log("Reconnect already scheduled.");
            return;
        }

        console.log(`Attempting to reconnect in ${RECONNECT_DELAY_MS / 1000} seconds...`);
        // Clear old socket instance before attempting reconnect
        this.ws = null;
        this.isConnecting = false; // Allow reconnect attempt

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null; // Clear the timeout handle
            console.log("Reconnecting now...");
            this.connect();
        }, RECONNECT_DELAY_MS);
    }

    // --- Event Handlers ---

    private onOpen(): void {
        this.isConnecting = false; // Successfully connected
        console.log(`Connected to Vybe WebSocket at ${this.getTimestamp()}`);
        if (this.currentFilters) {
            this.sendConfiguration(this.currentFilters);
        } else {
            console.warn("WebSocket connected but no filters provided to send.");
        }
    }

    private onMessage(message: WebSocket.Data): void {
        try {
            const messageString = message.toString();
            const parsedMessage = JSON.parse(messageString);
            // Distribute message to all registered handlers
            if (this.messageHandlers.length > 0) {
                this.messageHandlers.forEach(handler => {
                    try {
                        handler(parsedMessage);
                    } catch (handlerError) {
                        console.error("Error in message handler:", handlerError);
                    }
                });
            }

        } catch (err) {
            console.error("Failed to parse WebSocket message:", err, message.toString());
        }
    }

    private onClose(code: number, reason: Buffer): void {
        this.isConnecting = false; // No longer connecting
        const reasonString = reason.toString();
        console.log(`WebSocket connection closed at ${this.getTimestamp()}`);
        console.log(`Code: ${code}, Reason: ${reasonString || '(No reason provided)'}`);
        this.ws = null; // Ensure socket instance is cleared

        // Attempt reconnect only if closure was unexpected (code !== 1000) or if enabled regardless
        if (code !== 1000 && ENABLE_RECONNECT) {
            this.attemptReconnect();
        } else if (ENABLE_RECONNECT && code === 1000) {
            console.log("Normal closure (code 1000), reconnect behavior depends on strategy. Currently reconnecting if enabled.");
            // Decide if you want to reconnect even on normal closure
            this.attemptReconnect();
        } else {
            console.log("Reconnect not attempted based on close code and settings.");
        }
    }

    private onError(error: Error): void {
        this.isConnecting = false; // Error occurred, no longer actively connecting
        console.error(`WebSocket error at ${this.getTimestamp()}:`, error.message);
        // Don't call attemptReconnect here, 'close' event will fire after 'error'
        // which will handle the reconnect logic based on its code.
        // Forcing reconnect here might lead to double attempts.
    }
}

// Export a singleton instance
export const vybeWebSocketService = new VybeWebSocketService(); 