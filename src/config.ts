export interface ProgramConfig {
    id: string;
    name: string;
}

export const DEX_PROGRAMS: ProgramConfig[] = [
    {
        id: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
        name: 'Pump Swap'
    },
    {
        id: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
        name: 'Raydium CPMM'
    },
    {
        id: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        name: 'Raydium LP V4'
    },
    {
        id: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
        name: 'Raydium CLMM'
    },
    {
        id: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        name: 'Jupiter Swap V6'
    },
    {
        id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        name: 'Pump.fun'
    },
    {
        id: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
        name: 'Meteora DLMM'
    },
    {
        id: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
        name: 'Orca Whirlpool'
    }
];

// Token tracking configuration - mint addresses of tokens to track
export const TRACKED_TOKENS = [
    '11111111111111111111111111111111',       // SOL
    '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    'LAYER4xPpTCb3QL8S9u41EAhAX7mhBn8Q6xMTwY2Yzc',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
    'CDBdbNqmrLu1PcgjrFG52yxg71QnFhBZcUE6PSFdbonk'
];

// Price alert configuration
export const PRICE_ALERT_CONFIG = {
    pollingIntervalMs: 360 * 1000,           // 1 minute in milliseconds
    generalAlertThresholdPercent: 3,        // 3% change triggers general alert
    maxAlertsPerUser: 5,                    // Maximum 5 alerts per user
    tooCloseThresholdPercent: 1,            // Target within 2% of current price is too close
    tooFarThresholdPercent: 10              // Target more than 10% from current price is too far
};
