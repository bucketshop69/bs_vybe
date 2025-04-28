// src/imageGenerator.ts (assuming source is in 'src')
import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image as CanvasImage, Canvas } from 'canvas';
import * as path from 'path'; // Use import for path
import * as fs from 'fs'; // Add fs import
// Assuming your actual data fetching function exists and returns a specific type
// import { fetchActualTokenData, TokenData } from './your-api-module'; // Import your data fetching logic and type

// Define an interface for your token data structure (if not imported)
interface TokenData {
    symbol: string;
    // name?: string; // Optional if you don't draw it
    priceChange24h: number;
    priceChange7d: number;
}

// Optional: Register font if not installed globally on server
// Adjust path as needed
// try {
//   registerFont(path.join(__dirname, '..', 'fonts', 'arial.ttf'), { family: 'Arial' });
// } catch (fontError) {
//   console.warn("Could not register font. Ensure 'Arial' is installed on the server.", fontError);
// }

// Main function to generate the image
export async function generatePriceBoardImage(): Promise<Buffer> {
    try {
        // --- Fetch REAL Data ---
        // Replace with your actual data fetching:
        // const tokenData: TokenData[] = await fetchActualTokenData();
        // Using mock data for example structure:
        const tokenData: TokenData[] = [
            { symbol: 'BONK', priceChange24h: 6.2, priceChange7d: 20.5 },
            { symbol: 'JUP', priceChange24h: 3.8, priceChange7d: 15.3 },
            { symbol: 'WIF', priceChange24h: -2.4, priceChange7d: 43.6 },
            { symbol: 'PYTH', priceChange24h: 0.5, priceChange7d: 8.1 },
            { symbol: 'RAY', priceChange24h: 4.1, priceChange7d: 10.4 },
            { symbol: 'ORCA', priceChange24h: 1.9, priceChange7d: -2.0 },
            { symbol: 'HNT', priceChange24h: -3.3, priceChange7d: -5.6 },
            { symbol: 'MNDE', priceChange24h: 7.4, priceChange7d: 17.1 },
            { symbol: 'JTO', priceChange24h: 5.0, priceChange7d: 26.8 },
            { symbol: 'SLERF', priceChange24h: -1.8, priceChange7d: 4.7 },
        ]; // Ensure this matches your TokenData interface

        if (!tokenData || tokenData.length === 0) {
            throw new Error("No token data fetched");
        }

        // --- Load Base Image ---
        // Use a path relative to the project root instead of __dirname
        const projectRoot = path.resolve(__dirname, '..', '..'); // Go up from dist/utils to project root
        const imagePath = path.join(projectRoot, 'src', 'utils', 'blank_board.png');

        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Image not found at path: ${imagePath}`);
        }

        console.log(`Attempting to load image from: ${imagePath}`);
        const baseImage: CanvasImage = await loadImage(imagePath);

        // --- Create Canvas ---
        const canvas: Canvas = createCanvas(baseImage.width, baseImage.height);
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d');

        // --- PASTE YOUR FINALIZED DRAWING LOGIC HERE ---
        console.log('Starting canvas drawing on server...');
        ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

        // --- Parameters ---
        const fontFamily: string = '"Arial", sans-serif'; // ENSURE FONT AVAILABILITY
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
        const lineHeight: number = 50;
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
        ctx.font = `${baseFontSize}px ${fontFamily}`;
        tokenData.forEach((token: TokenData, index: number) => {
            const currentY: number = startY + (index * lineHeight);
            ctx.fillStyle = baseTextColor;
            ctx.textAlign = 'left';
            ctx.fillText(token.symbol, startX + colOffsets.symbol, currentY);
            ctx.textAlign = 'right';
            const change24hText: string = `${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}%`;
            ctx.fillStyle = token.priceChange24h >= 0 ? positiveColor : negativeColor;
            ctx.fillText(change24hText, header2X, currentY);
            const change7dText: string = `${token.priceChange7d >= 0 ? '+' : ''}${token.priceChange7d.toFixed(1)}%`;
            ctx.fillStyle = token.priceChange7d >= 0 ? positiveColor : negativeColor;
            ctx.fillText(change7dText, header3X, currentY);
        });

        ctx.restore();
        console.log('Canvas drawing finished.');
        // --- END OF DRAWING LOGIC ---

        // --- Export to Buffer ---
        const buffer: Buffer = canvas.toBuffer('image/png');
        console.log('Image buffer created.');
        return buffer;

    } catch (error) {
        console.error("Error generating price board image:", error);
        // Enhance error logging or handling if needed
        if (error instanceof Error) {
            throw new Error(`Image generation failed: ${error.message}`);
        } else {
            throw new Error(`An unknown error occurred during image generation.`);
        }
    }
}