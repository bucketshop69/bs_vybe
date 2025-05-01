// src/imageGenerator.ts (assuming source is in 'src')
import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image as CanvasImage, Canvas } from 'canvas';
import * as path from 'path'; // Use import for path
import * as fs from 'fs'; // Add fs import
import { TokenDetails, getAllTrackedTokenPrices, getTokenPrices } from '../vybeApi';
import { TRACKED_TOKENS } from '../config';

// Register Montserrat font if available
try {
    const fontPath = path.join(__dirname, '..', 'fonts', 'Montserrat-Bold.ttf');
    if (fs.existsSync(fontPath)) {
        registerFont(fontPath, { family: 'Montserrat', weight: 'bold' });
        // console.log('Montserrat font registered.');
    }
} catch (fontError) {
    // console.warn("Could not register Montserrat font. Ensure the TTF is available in src/fonts.", fontError);
}

// Define interface for token data used in image generation
interface TokenData {
    symbol: string;
    name: string;
    price: number;
    price1d: number;
    price7d: number;
    logoUrl: string;
    marketCap: number;
}

// Function to transform Vybe API token data to our image generation format
function transformTokenData(tokenDetails: TokenDetails): TokenData {
    return {
        symbol: tokenDetails.symbol,
        name: tokenDetails.name,
        price: tokenDetails.price,
        price1d: tokenDetails.price1d,
        price7d: tokenDetails.price7d,
        logoUrl: tokenDetails.logoUrl,
        marketCap: tokenDetails.marketCap
    };
}

// Configuration interface for image generation
interface ImageConfig {
    limit?: number;              // Number of tokens to display (default: 10)
    specificTokens?: string[];   // Specific tokens to include (optional)
    timeframes?: {               // Time periods for comparison
        shortTerm?: number;      // Default: 24h
        longTerm?: number;       // Default: 7d
    };
    sortBy?: 'marketCap' | 'volume' | 'priceChange'; // Sorting method
    sortOrder?: 'asc' | 'desc';  // Sort order
}

// Default configuration
const DEFAULT_CONFIG: ImageConfig = {
    limit: 10,
    timeframes: {
        shortTerm: 24,
        longTerm: 168 // 7 days in hours
    },
    sortBy: 'marketCap',
    sortOrder: 'desc'
};

// Cache configuration
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

class TokenDataCache {
    private static instance: TokenDataCache;
    private cache: Map<string, CacheEntry<TokenData[]>>;
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

    private constructor() {
        this.cache = new Map();
    }

    public static getInstance(): TokenDataCache {
        if (!TokenDataCache.instance) {
            TokenDataCache.instance = new TokenDataCache();
        }
        return TokenDataCache.instance;
    }

    public get(key: string): TokenData[] | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        const now = Date.now();
        if (now - entry.timestamp > this.CACHE_DURATION) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    public set(key: string, data: TokenData[]): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    public clear(): void {
        this.cache.clear();
    }
}

// Error types
class ImageGenerationError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'ImageGenerationError';
    }
}

// Function to fetch and prepare token data for image generation
async function fetchTokenData(config: ImageConfig = DEFAULT_CONFIG): Promise<TokenData[]> {
    const cache = TokenDataCache.getInstance();
    const cacheKey = JSON.stringify(config);

    try {
        // Try to get data from cache first
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            // console.log('Using cached token data');
            return cachedData;
        }

        // console.log('Fetching token data using TRACKED_TOKENS');
        const tokenMap = await getTokenPrices(TRACKED_TOKENS);
        const tokenPrices = Array.from(tokenMap.values());

        if (!tokenPrices || tokenPrices.length === 0) {
            throw new ImageGenerationError('No token data available from API', 'NO_DATA');
        }

        // Transform tokens
        let transformedTokens = tokenPrices
            .map(token => transformTokenData(token as unknown as TokenDetails));

        // Filter specific tokens if provided
        if (config.specificTokens && config.specificTokens.length > 0) {
            transformedTokens = transformedTokens.filter(token =>
                config.specificTokens!.includes(token.symbol)
            );

            if (transformedTokens.length === 0) {
                throw new ImageGenerationError('No matching tokens found for specified symbols', 'NO_MATCHING_TOKENS');
            }
        }

        // Sort tokens based on configuration
        transformedTokens.sort((a, b) => {
            let comparison = 0;
            switch (config.sortBy) {
                case 'marketCap':
                    comparison = b.marketCap - a.marketCap;
                    break;
                case 'volume':
                    comparison = 0;
                    break;
                case 'priceChange':
                    const aChange = ((a.price - a.price1d) / a.price1d) * 100;
                    const bChange = ((b.price - b.price1d) / b.price1d) * 100;
                    comparison = bChange - aChange;
                    break;
            }
            return config.sortOrder === 'desc' ? comparison : -comparison;
        });

        // Apply limit
        const result = transformedTokens.slice(0, config.limit);

        // Cache the result
        cache.set(cacheKey, result);

        return result;
    } catch (error) {
        if (error instanceof ImageGenerationError) {
            throw error;
        }
        throw new ImageGenerationError(
            `Error fetching token data: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'FETCH_ERROR'
        );
    }
}

export async function generatePriceBoardImage(config: ImageConfig = DEFAULT_CONFIG): Promise<Buffer> {
    try {
        // Fetch token data based on configuration
        const tokenData: TokenData[] = await fetchTokenData(config);

        if (!tokenData || tokenData.length === 0) {
            throw new ImageGenerationError("No token data available", "NO_DATA");
        }

        // --- Load Base Image ---
        const projectRoot = path.resolve(__dirname, '..', '..');
        const imagePath = path.join(projectRoot, 'src', 'utils', 'blank_board.png');

        if (!fs.existsSync(imagePath)) {
            throw new ImageGenerationError(`Image not found at path: ${imagePath}`, "MISSING_TEMPLATE");
        }

        // console.log(`Attempting to load image from: ${imagePath}`);
        const baseImage: CanvasImage = await loadImage(imagePath);

        // --- Create Canvas ---
        // Make canvas height dynamic based on number of tokens
        const baseHeight = baseImage.height;
        const lineHeight = 50;
        const extraHeight = Math.max(0, (tokenData.length - 10) * lineHeight);
        const canvas: Canvas = createCanvas(baseImage.width, baseHeight + extraHeight);
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d');

        // --- PASTE YOUR FINALIZED DRAWING LOGIC HERE ---
        // console.log('Starting canvas drawing on server...');
        ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

        // --- Parameters ---
        const fontFamily: string = '"Arial", sans-serif';
        const baseFontSize: number = 29;
        const titleFontSize: number = 36;
        const headerFontSize: number = 23;
        const baseTextColor: string = '#E0E0E0';
        const positiveColor: string = '#66BB6A';
        const negativeColor: string = '#EF5350';
        const startX: number = 530;
        const startY: number = 280;
        const colOffsets = { symbol: 0, change24h: 185, change7d: 345 };
        const numberColumnWidth: number = 100;
        const headerYOffset: number = -68;
        const titleYOffset: number = -128;
        const headerLineSpacing: number = 27;
        const tableShearAmount: number = -0.07;
        const titleShearAmount: number = -0.12;

        // === Draw Title (Transformed) ===
        ctx.save();
        ctx.transform(1, 0, titleShearAmount, 1, 0, 0);
        ctx.font = `bold ${titleFontSize}px ${fontFamily}`;
        ctx.fillStyle = baseTextColor;
        ctx.textAlign = 'center';
        const tableCenterX: number = startX + (colOffsets.change7d + numberColumnWidth) / 2;
        ctx.fillText('SOLANA COIN PRICES', tableCenterX, startY + titleYOffset);
        ctx.restore();

        // === Draw Table (Transformed) ===
        ctx.save();
        ctx.transform(1, 0, tableShearAmount, 1, 0, 0);

        // Draw Headers
        ctx.font = `bold ${headerFontSize}px ${fontFamily}`;
        ctx.fillStyle = baseTextColor;
        ctx.textAlign = 'left';
        ctx.fillText('Coin', startX + colOffsets.symbol, startY + headerYOffset);
        ctx.textAlign = 'right';
        const header2X: number = startX + colOffsets.change24h + (numberColumnWidth / 2);
        ctx.fillText('Price Change', header2X, startY + headerYOffset);
        ctx.fillText('(24h)', header2X, startY + headerYOffset + headerLineSpacing);
        const header3X: number = startX + colOffsets.change7d + (numberColumnWidth / 2);
        ctx.fillText('Price Change', header3X, startY + headerYOffset);
        ctx.fillText('(7d)', header3X, startY + headerYOffset + headerLineSpacing);

        // Draw Data Rows
        ctx.font = `bold ${baseFontSize}px ${fontFamily}`;
        tokenData.forEach((token: TokenData, index: number) => {
            const currentY: number = startY + (index * lineHeight);
            ctx.fillStyle = baseTextColor;
            ctx.textAlign = 'left';
            ctx.fillText(token.symbol, startX + colOffsets.symbol, currentY);
            ctx.textAlign = 'right';

            // Calculate price changes
            const priceChange24h = ((token.price - token.price1d) / token.price1d) * 100;
            const priceChange7d = ((token.price - token.price7d) / token.price7d) * 100;

            // Format for Infinity
            const formatChange = (change: number) => {
                if (!isFinite(change)) return '+100%';
                return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
            };

            const change24hText: string = formatChange(priceChange24h);
            ctx.fillStyle = priceChange24h >= 0 ? positiveColor : negativeColor;
            ctx.fillText(change24hText, header2X, currentY);

            const change7dText: string = formatChange(priceChange7d);
            ctx.fillStyle = priceChange7d >= 0 ? positiveColor : negativeColor;
            ctx.fillText(change7dText, header3X, currentY);
        });

        ctx.restore();
        // console.log('Canvas drawing finished.');
        // --- END OF DRAWING LOGIC ---

        // --- Export to Buffer ---
        const buffer: Buffer = canvas.toBuffer('image/png');
        // console.log('Image buffer created.');
        return buffer;

    } catch (error) {
        // console.error("Error generating price board image:", error);
        if (error instanceof Error) {
            throw new Error(`Image generation failed: ${error.message}`);
        } else {
            throw new Error(`An unknown error occurred during image generation.`);
        }
    }
}
