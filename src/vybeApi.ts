import axios from 'axios';
import dotenv from 'dotenv';
import { DEX_PROGRAMS, TRACKED_TOKENS } from './config';
import { TokenPrice } from './database';

// Load environment variables
dotenv.config();

// Type definitions for the API response
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

// Interface for token transfers
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

interface TokenInstructionData {
    callingInstructions: number[];
    ixName: string;
    callingProgram: string;
    programName: string;
}

interface TokenInstructionResponse {
    data: TokenInstructionData[];
}

// Export TokenDetails interface for use in other files
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

// Token API rate limiting configuration
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

// Check if we're within rate limits
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

// Calculate wait time if rate limited
function getRateLimitWaitTime(): number {
    return TOKEN_API_RATE_LIMIT.resetTime - Date.now();
}

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

        // Return the token details - API returns the details directly in the data property
        return response.data;
    } catch (error) {
        console.error(`Error fetching token details for ${mintAddress}:`, error);
        return mintAddress;
    }
}

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
 * Checks if a token exists in the Vybe API
 * @param mintAddress Token mint address to verify
 * @returns Promise<boolean> True if token exists and data can be fetched
 */
export async function verifyToken(mintAddress: string): Promise<boolean> {
    try {
        const tokenDetails = await getTokenDetails(mintAddress);
        return typeof tokenDetails !== 'string';
    } catch (error) {
        console.error(`Error verifying token ${mintAddress}:`, error);
        return false;
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
 * Tests the ranked DEX data fetching
 */
export async function testRankedDexData() {
    console.log('Testing ranked DEX data fetching...');
    const rankedData = await getRankedDexData();

    console.log('\nRanked DEX Programs by DAU:');
    rankedData.forEach((data, index) => {
        console.log(`\n${index + 1}. ${data.name} (${data.shortId})`);
        console.log(`   DAU: ${data.currentDau.toLocaleString()}`);
        console.log(`   24h Change: ${data.percentChange24h !== null ? `${data.percentChange24h.toFixed(2)}%` : 'N/A'}`);
    });
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

/**
 * Tests the digest message formatting
 */
export async function testDigestFormatting() {
    console.log('Testing digest message formatting...');
    const rankedData = await getRankedDexData();
    const message = formatDigestMessage(rankedData);
    console.log('\nFormatted Digest Message:');
    console.log(message);
}

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
 * Tests fetching prices for all tracked tokens
 */
export async function testTokenPrices() {
    console.log('Testing token price fetching for all tracked tokens...');
    const tokenPrices = await getAllTrackedTokenPrices();

    console.log('\nToken prices:');
    tokenPrices.forEach(token => {
        console.log(`\n${token.symbol} (${token.mint_address.substring(0, 4)}...)`);
        console.log(`   Price: $${token.current_price.toFixed(4)}`);
        console.log(`   Last updated: ${new Date(token.last_update_time * 1000).toLocaleString()}`);
    });
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

// Run tests if this file is executed directly
if (require.main === module) {
    getRecentTransfersForWallet("7iNJ7CLNT8UBPANxkkrsURjzaktbomCVa93N1sKcVo9C")
        .then(res => {
            console.log(res);
        })
} 