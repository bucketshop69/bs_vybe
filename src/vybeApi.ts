import axios from 'axios';
import dotenv from 'dotenv';
import { DEX_PROGRAMS } from './config';

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

        console.log('API Response:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
        });

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

// Run tests if this file is executed directly
if (require.main === module) {
    testDigestFormatting().catch(console.error);
} 