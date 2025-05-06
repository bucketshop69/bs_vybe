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
    'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
    'CDBdbNqmrLu1PcgjrFG52yxg71QnFhBZcUE6PSFdbonk',
    '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
];

// Price alert configuration
export const PRICE_ALERT_CONFIG = {
    pollingIntervalMs: 3600 * 1000,           // 1h minute in milliseconds
    generalAlertThresholdPercent: 2.5,        // 3% change triggers general alert
    maxAlertsPerUser: 5,                    // Maximum 5 alerts per user
    tooCloseThresholdPercent: 0.2,            // Target within 2% of current price is too close
    tooFarThresholdPercent: 10              // Target more than 10% from current price is too far
};


export const KOLs_wallets = {
    "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o": "Cented7",
    "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd": "vibed333",
    "525LueqAyZJueCoiisfWy6nyh4MTvmF4X9jSqi6efXJT": "metaversejoji",
    "JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN": "ratwizardx",
    "73LnJ7G9ffBDjEBGgJDdgvLUhD5APLonKrNiHsKDCw5B": "waddles_eth",
    "6LChaYRYtEYjLEHhzo4HdEmgNwu2aia8CM8VhR9wn6n7": "assasin_eth",
    "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm": "Ga__ke",
    "DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj": "Euris_JT",
    "GfXQesPe3Zuwg8JhAt6Cg8euJDTVx751enp9EQQmhzPH": "spunosounds",
    "96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf": "OrangeSBS",
    "GM7Hrz2bDq33ezMtL6KGidSWZXMWgZ6qBuugkb5H8NvN": "beaverd",
    "Av3xWHJ5EsoLZag6pr7LKbrGgLRTaykXomDD5kBhL9YQ": "Heyitsyolotv",
    "8MaVa9kdt3NW4Q5HyNAm1X5LbR8PQRVDc1W8NMVK88D5": "daumeneth",
    "3pZ59YENxDAcjaKa3sahZJBcgER4rGYi4v6BpPurmsGj": "kadenox",
    "9Vk7pkBZ9KFJmzaPzNYjGedyz8qoKMQtnYyYi2AehNMT": "xelf_sol",
    "HwRnKq7RPtKHvX9wyHsc1zvfHtGjPQa5tyZtGtbvfXE": "BitBoyJay",
}