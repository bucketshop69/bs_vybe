import axios from 'axios';
import dotenv from 'dotenv';
import { DEX_PROGRAMS, TRACKED_TOKENS } from './config';
import { TokenPrice } from './database';

// Load environment variables
dotenv.config();

// === TYPE & INTERFACE DEFINITIONS ===
// DAU Related Types
export interface DauDataPoint {
    programId: string;
    dau: number;
    blockTime: number;
}

interface VybeApiResponse {
    data: DauDataPoint[];
}

interface DauMetrics {
    currentDau: number;
    percentChange24h: number | null;
}

interface RankedDexData {
    name: string;
    shortId: string;
    currentDau: number;
    percentChange24h: number | null;
}

// Token Transfer Related Types
export interface VybeTransfer {
    signature: string;
    blockTime: number;
    senderAddress: string;
    receiverAddress: string;
    amount: number;
    tokenDetails: TokenDetails | string;
}

interface VybeTransferResponse {
    transfers: Array<{
        signature: string;
        blockTime: number;
        senderAddress: string;
        receiverAddress: string;
        amount: number;
        calculatedAmount: string;
        mintAddress: string;
        valueUsd: string;
    }>;
}

// Token Instruction Related Types
interface TokenInstructionData {
    callingInstructions: number[];
    ixName: string;
    callingProgram: string;
    programName: string;
}

interface TokenInstructionResponse {
    data: TokenInstructionData[];
}

// Token Details Type
export interface TokenDetails {
    symbol: string;
    name: string;
    mintAddress: string;
    price: number;
    price1d: number;
    price7d: number;
    decimal: number;
    logoUrl: string;
    category: string;
    subcategory: string | null;
    verified: boolean;
    updateTime: number;
    currentSupply: number;
    marketCap: number;
    tokenAmountVolume24h: number;
    usdValueVolume24h: number;
}

// Known Account Related Types
export interface KnownAccount {
    ownerAddress: string;
    name: string;
    logoUrl: string;
    labels: string[];
    entity: string;
    entityId: number;
    twitterUrl: string;
    dateAdded: string;
}

interface KnownAccountsResponse {
    accounts: KnownAccount[];
}

export interface GetKnownAccountsOptions {
    ownerAddress?: string;
    name?: string;
    labels?: string[];
    entityName?: string;
    entityId?: number;
    sortByAsc?: string;
    sortByDesc?: string;
}

// PnL Related Types
interface TokenMetricsTrades {
    volumeUsd: number;
    tokenAmount: number;
    transactionCount: number;
}

interface TokenMetrics {
    tokenAddress: string;
    tokenSymbol: string;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    buys: TokenMetricsTrades;
    sells: TokenMetricsTrades;
}

interface BestWorstToken {
    tokenSymbol: string;
    tokenAddress: string;
    tokenName: string;
    tokenLogoUrl: string;
    pnlUsd: number;
}

interface PnLSummary {
    winRate: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    uniqueTokensTraded: number;
    averageTradeUsd: number;
    tradesCount: number;
    winningTradesCount: number;
    losingTradesCount: number;
    tradesVolumeUsd: number;
    bestPerformingToken: BestWorstToken | null;
    worstPerformingToken: BestWorstToken | null;
    pnlTrendSevenDays: [number, number][];
}

interface AccountPnLResponse {
    summary: PnLSummary;
    tokenMetrics: TokenMetrics[];
}

export interface GetAccountPnLOptions {
    resolution?: string;
    tokenAddress?: string;
    sortByAsc?: string;
    sortByDesc?: string;
    limit?: number;
    page?: number;
}

export interface KOLAccountWithPnL extends KnownAccount {
    pnlData: AccountPnLResponse;
}

// === UTILITY FUNCTIONS ===
// Rate Limiting Configuration
const TOKEN_API_RATE_LIMIT = {
    maxRequestsPerMinute: 60,
    requestCount: 0,
    resetTime: Date.now() + 60000,
};

// Reset the rate limit counter every minute
setInterval(() => {
    TOKEN_API_RATE_LIMIT.requestCount = 0;
    TOKEN_API_RATE_LIMIT.resetTime = Date.now() + 60000;
}, 60000);

/**
 * Checks if we're within rate limits
 * @returns boolean indicating if request should proceed
 */
function checkRateLimit(): boolean {
    // Reset counter if we're in a new minute
    if (Date.now() > TOKEN_API_RATE_LIMIT.resetTime) {
        TOKEN_API_RATE_LIMIT.requestCount = 0;
        TOKEN_API_RATE_LIMIT.resetTime = Date.now() + 60000;
    }

    // Check if we've exceeded our limit
    if (TOKEN_API_RATE_LIMIT.requestCount >= TOKEN_API_RATE_LIMIT.maxRequestsPerMinute) {
        return false;
    }

    // Increment the counter and allow the request
    TOKEN_API_RATE_LIMIT.requestCount++;
    return true;
}

/**
 * Calculates wait time if rate limited
 * @returns number of milliseconds to wait
 */
function getRateLimitWaitTime(): number {
    return TOKEN_API_RATE_LIMIT.resetTime - Date.now();
}

// === API CLIENT FUNCTIONS ===
/**
 * Gets the token details for a given mint address
 * @param mintAddress The token's mint address
 * @returns Promise containing the token details or mint address on error
 */
export async function getTokenDetails(mintAddress: string): Promise<TokenDetails | string> {
    const apiKey = process.env.VYBE_KEY;
    if (!apiKey) {
        console.error('VYBE_KEY is not set in environment variables');
        return mintAddress;
    }

    // Check rate limit
    if (!checkRateLimit()) {
        const waitTime = getRateLimitWaitTime();
        console.warn(`Rate limit reached, waiting ${waitTime}ms before retrying`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
        const response = await axios.get<TokenDetails>(
            `https://api.vybenetwork.xyz/token/${mintAddress}`,
            {
                headers: {
                    'accept': 'application/json',
                    'X-API-KEY': apiKey
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error(`Error fetching token details for ${mintAddress}:`, error);
        return mintAddress;
    }
}

// === BUSINESS LOGIC FUNCTIONS ===
// Token Price Related Functions
/**
 * Fetches the latest token prices for a list of mint addresses
 * @param mintAddresses Array of token mint addresses
 * @returns Promise containing a map of mint addresses to token details
 */
export async function getTokenPrices(mintAddresses: string[]): Promise<Map<string, TokenDetails>> {
    const tokenMap = new Map<string, TokenDetails>();

    // Create an array of promises with exponential backoff for rate limiting
    const fetchPromises = mintAddresses.map(async (mintAddress, index) => {
        // Stagger requests slightly to avoid hitting rate limits
        if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 100 * index));
        }

        try {
            const result = await getTokenDetails(mintAddress);
            if (typeof result !== 'string') {
                tokenMap.set(mintAddress, result);
            }
        } catch (error) {
            console.error(`Error fetching token ${mintAddress}:`, error);
        }
    });

    // Wait for all requests to complete
    await Promise.all(fetchPromises);

    return tokenMap;
}

/**
 * Fetches prices for all tracked tokens from config
 * @returns Promise containing an array of token price objects
 */
export async function getAllTrackedTokenPrices(): Promise<TokenPrice[]> {
    try {
        const tokenMap = await getTokenPrices(TRACKED_TOKENS);
        const now = Math.floor(Date.now() / 1000);

        return Array.from(tokenMap.values()).map(token => ({
            mint_address: token.mintAddress,
            symbol: token.symbol,
            name: token.name,
            current_price: token.price,
            last_update_time: now
        }));
    } catch (error) {
        console.error('Error fetching tracked token prices:', error);
        return [];
    }
}

/**
 * Gets the current price for a specific token
 * @param mintAddress Token mint address
 * @returns Promise containing the token price data or null on error
 */
export async function getTokenPrice(mintAddress: string): Promise<TokenPrice | null> {
    try {
        const tokenDetails = await getTokenDetails(mintAddress);

        if (typeof tokenDetails === 'string') {
            return null;
        }

        return {
            mint_address: tokenDetails.mintAddress,
            symbol: tokenDetails.symbol,
            name: tokenDetails.name,
            current_price: tokenDetails.price,
            last_update_time: Math.floor(Date.now() / 1000)
        };
    } catch (error) {
        console.error(`Error fetching price for token ${mintAddress}:`, error);
        return null;
    }
}

/**
 * Calculates the percentage change between two price points
 * @param currentPrice Current token price
 * @param previousPrice Previous token price
 * @returns Percentage change (positive or negative)
 */
export function calculatePriceChangePercent(currentPrice: number, previousPrice: number): number {
    if (previousPrice === 0) return 0;
    return ((currentPrice - previousPrice) / previousPrice) * 100;
}

// DAU Related Functions
/**
 * Fetches the last two days of DAU data for a specific program ID
 * @param programId The Solana program ID to fetch data for
 * @returns Promise containing an array of DAU data points or null if the request fails
 */
export async function getProgramDauTimeSeries(programId: string): Promise<DauDataPoint[] | null> {
    const apiKey = process.env.VYBE_KEY;
    console.log("apiKey", apiKey);

    if (!apiKey) {
        console.error('VYBE_KEY is not set in environment variables');
        return null;
    }

    try {
        console.log(`Making request to Vybe API for program ${programId}`);
        const response = await axios.get<VybeApiResponse>(
            `https://api.vybenetwork.xyz/program/${programId}/active-users-ts`,
            {
                params: {
                    range: '2d'
                },
                headers: {
                    'X-API-KEY': apiKey
                }
            }
        );

        // Validate response data
        if (!response.data?.data || !Array.isArray(response.data.data)) {
            console.error(`Invalid response format for program ${programId}:`, response.data);
            return null;
        }

        // Ensure we have at least one data point
        if (response.data.data.length === 0) {
            console.error(`No data points returned for program ${programId}`);
            return null;
        }

        return response.data.data;
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`Error fetching data for program ${programId}:`, {
                message: error.message,
                stack: error.stack
            });
        } else {
            console.error(`Unexpected error fetching data for program ${programId}:`, error);
        }
        return null;
    }
}

/**
 * Fetches and calculates DAU metrics for a specific program
 * @param programId The Solana program ID to fetch data for
 * @returns Promise containing DAU metrics or null if calculation is not possible
 */
export async function getProgramDauMetrics(programId: string): Promise<DauMetrics | null> {
    const timeSeriesData = await getProgramDauTimeSeries(programId);

    if (!timeSeriesData || timeSeriesData.length < 2) {
        console.error('Invalid time series data: need at least 2 data points');
        return null;
    }

    // Sort data by blockTime to ensure chronological order (oldest first)
    const sortedData = [...timeSeriesData].sort((a, b) => a.blockTime - b.blockTime);

    // Get the two most recent data points
    const previousData = sortedData[sortedData.length - 2];
    const currentData = sortedData[sortedData.length - 1];

    // Extract DAU values
    const previousDau = previousData.dau;
    const currentDau = currentData.dau;

    // Calculate percentage change
    let percentChange24h: number | null = null;
    if (previousDau > 0) {
        percentChange24h = ((currentDau - previousDau) / previousDau) * 100;
    }

    return {
        currentDau,
        percentChange24h
    };
}

/**
 * Fetches and ranks DAU data for all configured DEX programs
 * @returns Promise containing an array of ranked DEX data, sorted by current DAU
 */
export async function getRankedDexData(): Promise<RankedDexData[]> {
    console.log('Fetching DAU data for all DEX programs...');

    // Use Promise.allSettled to handle potential failures gracefully
    const results = await Promise.allSettled(
        DEX_PROGRAMS.map(async (program) => {
            try {
                const metrics = await getProgramDauMetrics(program.id);
                if (!metrics) {
                    throw new Error(`Failed to get metrics for ${program.name}`);
                }

                return {
                    name: program.name,
                    shortId: program.id.substring(0, 4) + '...',
                    currentDau: metrics.currentDau,
                    percentChange24h: metrics.percentChange24h
                };
            } catch (error) {
                console.error(`Error processing ${program.name} (${program.id}):`, error);
                throw error; // Re-throw to be caught by Promise.allSettled
            }
        })
    );

    // Process results and filter out failed promises
    const successfulResults: RankedDexData[] = results
        .filter((result): result is PromiseFulfilledResult<RankedDexData> =>
            result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);

    // Sort by currentDau in descending order
    successfulResults.sort((a, b) => b.currentDau - a.currentDau);

    console.log(`Successfully processed ${successfulResults.length} out of ${DEX_PROGRAMS.length} programs`);
    return successfulResults;
}

/**
 * Formats the ranked DEX data into a digest message
 * @param rankedData Array of ranked DEX data
 * @returns Formatted message string
 */
export function formatDigestMessage(rankedData: RankedDexData[]): string {
    // Get current date in YYYY-MM-DD format
    const currentDate = new Date().toISOString().split('T')[0];

    // Start building the message
    let message = `⚙️ #VybeDigest Solana DEX Check-In - ${currentDate}\n\n`;
    message += `👥 **DEX User Activity (DAU - 24h Change):**\n\n`;

    // Add each program's data
    rankedData.forEach((programData, index) => {
        // Format the percentage change
        const formattedChange = programData.percentChange24h !== null
            ? `${programData.percentChange24h.toFixed(1)}%`
            : 'N/A';

        // Determine the emoji based on change
        let emoji = '⚪️'; // Default for null/zero
        if (programData.percentChange24h !== null) {
            emoji = programData.percentChange24h > 0 ? '🟢' : '🔴';
        }

        // Add the program line
        message += `${index + 1}. **${programData.name}** (\`${programData.shortId}\`): `;
        message += `${programData.currentDau.toLocaleString()} Users (${formattedChange}) ${emoji}\n`;
    });

    // Add footer
    message += '\n---\n';
    message += '📊 Deep dive on AlphaVybe | Follow us @AlphaVybe\n';
    message += '🔔 DM me /start to track specific tokens & whale wallets!';

    return message;
}

// Wallet Related Functions
/**
 * Fetches recent token transfers for a specific wallet address
 * @param walletAddress The Solana wallet address to fetch transfers for
 * @param limit Maximum number of transfers to return (default: 5)
 * @returns Promise containing an array of transfers or null if the request fails
 */
export async function getRecentTransfersForWallet(
    walletAddress: string,
    limit: number = 5
): Promise<VybeTransfer[] | null> {
    const apiKey = process.env.VYBE_KEY;
    console.log(walletAddress);

    if (!apiKey) {
        console.error('VYBE_KEY is not set in environment variables');
        return null;
    }

    try {
        const response = await axios.get<VybeTransferResponse>(
            'https://api.vybenetwork.xyz/token/transfers',
            {
                params: {
                    feePayer: walletAddress,
                    limit,
                    sortByDesc: 'blockTime',
                    senderAddress: walletAddress,
                },
                headers: {
                    'X-API-KEY': apiKey
                }
            }
        );
        console.log(response.data);

        if (!response.data?.transfers || !Array.isArray(response.data.transfers)) {
            console.error('Invalid response format for wallet transfers:', response.data);
            return null;
        }

        // Create an array of promises that resolve to VybeTransfer objects with awaited token details
        const transferPromises = response.data.transfers.map(async (transfer) => {
            const tokenDetails = await getTokenDetails(transfer.mintAddress);
            return {
                signature: transfer.signature,
                blockTime: transfer.blockTime,
                senderAddress: transfer.senderAddress,
                receiverAddress: transfer.receiverAddress,
                amount: transfer.amount,
                tokenDetails
            };
        });
        const transfers = await Promise.all(transferPromises);
        // Await all the promises to resolve
        return transfers;
    } catch (error) {
        console.error(`Error fetching transfers for wallet ${walletAddress}:`, error);
        return null;
    }
}

/**
 * Get token details by symbol or mint address
 * @param symbolOrAddress Token symbol or mint address
 * @returns Promise containing the token price or null if not found
 */
export async function getTokenBySymbolOrAddress(symbolOrAddress: string): Promise<TokenPrice | null> {
    try {
        // If it's a valid mint address, try to get it directly
        if (symbolOrAddress.length >= 32) {
            return await getTokenPrice(symbolOrAddress);
        }

        // Otherwise, get all tokens and find by symbol (case insensitive)
        const allTokens = await getAllTrackedTokenPrices();
        const normalizedInput = symbolOrAddress.trim().toLowerCase();

        // Find token by symbol match
        const token = allTokens.find(
            t => t.symbol.toLowerCase() === normalizedInput
        );

        return token || null;
    } catch (error) {
        console.error(`Error getting token by symbol or address (${symbolOrAddress}):`, error);
        return null;
    }
}

/**
 * Fetches recent transaction signatures for a specific wallet address using Helius RPC
 * @param walletAddress The Solana wallet address to fetch signatures for
 * @param limit Maximum number of signatures to return (default: 5)
 * @returns Promise containing an array of signature strings
 */
export async function getRecentSignaturesForWallet(walletAddress: string, limit: number = 5): Promise<string[]> {
    const apiKey = process.env.HELIUS_RPC_KEY;
    if (!apiKey) {
        console.error('HELIUS_RPC_KEY is not set in environment variables');
        return [];
    }

    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    try {
        const response = await axios.post(heliusUrl, {
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [walletAddress, { limit }],
        });
        const data = response.data;
        if (data && typeof data === 'object' && 'result' in data && Array.isArray((data as any).result)) {
            return (data as any).result.map((entry: any) => entry.signature);
        }
        return [];
    } catch (error) {
        console.error(`Error fetching signatures for wallet ${walletAddress} from Helius:`, error);
        return [];
    }
}

// Account Related Functions
/**
 * Fetches known accounts based on optional filters
 * @param options Object containing optional query parameters
 * @returns Promise containing an array of known accounts or null if the request fails
 */
export async function getKnownAccounts(
    options: GetKnownAccountsOptions = {}
): Promise<KnownAccount[] | null> {
    const apiKey = process.env.VYBE_KEY;
    if (!apiKey) {
        console.error('VYBE_KEY is not set in environment variables');
        return null;
    }

    // Prepare params, converting labels array to comma-separated string if present
    const params: Record<string, any> = { ...options };
    if (params.labels && Array.isArray(params.labels)) {
        params.labels = params.labels.join(',');
    }

    try {
        const response = await axios.get<KnownAccountsResponse>(
            'https://api.vybenetwork.xyz/account/known-accounts',
            {
                params,
                headers: {
                    'accept': 'application/json',
                    'X-API-KEY': apiKey
                }
            }
        );

        if (!response.data?.accounts || !Array.isArray(response.data.accounts)) {
            console.error('Invalid response format for known accounts:', response.data);
            return null;
        }

        return response.data.accounts;
    } catch (error) {
        console.error('Error fetching known accounts:', error);
        return null;
    }
}


/**
 * Fetches all known accounts with the 'KOL' label
 * @returns Promise containing an array of known accounts labeled as KOL or null if the request fails
 */
export async function getKOLAccounts(): Promise<KnownAccount[] | null> {
    return getKnownAccounts({ labels: ['KOL'] });
}


if (require.main === module) {
    getKOLAccounts()
        .then(kolaAccounts => {
            console.log(kolaAccounts);
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

/**
 * Fetches PnL (Profit and Loss) data for a specific account
 * @param ownerAddress The account address to fetch PnL for (required)
 * @param options Optional parameters for filtering and pagination
 * @returns Promise containing the account's PnL data or null if the request fails
 */
export async function getAccountPnL(
    ownerAddress: string,
    options: GetAccountPnLOptions = {}
): Promise<AccountPnLResponse | null> {
    const apiKey = process.env.VYBE_KEY;
    if (!apiKey) {
        console.error('VYBE_KEY is not set in environment variables');
        return null;
    }

    try {
        // Set default values for resolution and limit
        const params = {
            resolution: '1d',
            limit: 30,
            ...options
        };

        const response = await axios.get<AccountPnLResponse>(
            `https://api.vybenetwork.xyz/account/pnl/${ownerAddress}`,
            {
                params,
                headers: {
                    'accept': 'application/json',
                    'X-API-KEY': apiKey
                }
            }
        );

        if (!response.data?.summary || !response.data?.tokenMetrics) {
            console.error('Invalid response format for account PnL:', response.data);
            return null;
        }

        return response.data;
    } catch (error) {
        console.error(`Error fetching PnL data for account ${ownerAddress}:`, error);
        return null;
    }
}

/**
 * Fetches all KOL accounts and their PnL data, filtering for accounts with trading activity
 * @returns Promise containing an array of KOL accounts with their PnL data
 */
export async function getActiveKOLAccounts(): Promise<KOLAccountWithPnL[] | null> {
    try {
        // First get all KOL accounts
        const kolAccounts = await getKOLAccounts();
        if (!kolAccounts) {
            console.error('Failed to fetch KOL accounts');
            return null;
        }

        // Fetch PnL data for each KOL account
        const accountsWithPnL = await Promise.all(
            kolAccounts.map(async (account) => {
                const pnlData = await getAccountPnL(account.ownerAddress);
                if (pnlData && pnlData.tokenMetrics.length > 0) {
                    return {
                        ...account,
                        pnlData
                    };
                }
                return null;
            })
        );

        // Filter out accounts with no PnL data and remove nulls
        const activeAccounts = accountsWithPnL.filter((account): account is KOLAccountWithPnL =>
            account !== null
        );

        console.log(`Found ${activeAccounts.length} active KOL accounts out of ${kolAccounts.length} total`);
        return activeAccounts;
    } catch (error) {
        console.error('Error fetching active KOL accounts:', error);
        return null;
    }
}

// Example usage in main
if (require.main === module) {
    getActiveKOLAccounts()
        .then(activeKOLs => {
            if (activeKOLs) {
                console.log(`Active KOLs with trading activity: ${activeKOLs.length}`);
                activeKOLs.forEach(kol => {
                    console.log(`\nKOL: ${kol.name}`);
                    console.log(`Address: ${kol.ownerAddress}`);
                    console.log(`Tokens traded: ${kol.pnlData.tokenMetrics.length}`);
                    console.log(`Total PnL: $${kol.pnlData.summary.realizedPnlUsd.toFixed(2)}`);
                });
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
}