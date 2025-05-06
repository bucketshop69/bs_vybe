// Simple logger utility
export const walletLog = {
    info: (message: string, ...args: any[]) => {
        console.log(`[Wallet] ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
        console.error(`[Wallet] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
        console.warn(`[Wallet] ${message}`, ...args);
    }
}; 