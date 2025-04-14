import dotenv from 'dotenv';
import { TRACKED_TOKENS } from './config';
import {
    getAllTrackedTokenPrices,
    getTokenPrice,
    getTokenPrices,
    verifyToken,
    calculatePriceChangePercent,
    TokenDetails
} from './vybeApi';
import { initializeDatabase, initializeTokenPriceCache } from './database';

// Load environment variables
dotenv.config();

// Check if environment variables are set
if (!process.env.VYBE_KEY) {
    console.error('❌ VYBE_KEY environment variable is missing!');
    process.exit(1);
}

// Helper function to format price with color
function formatPrice(price: number): string {
    return `$${price.toFixed(4)}`;
}

// Helper function to format percentage change with color indication
function formatPercentage(percent: number): string {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
}

// Helper to validate token data structure
function validateTokenStructure(token: TokenDetails): boolean {
    // Check that all required fields exist and have the right type
    const requiredStringFields = ['symbol', 'name', 'mintAddress', 'logoUrl', 'category'];
    const requiredNumberFields = ['price', 'price1d', 'price7d', 'decimal', 'updateTime'];

    // Check string fields
    const stringFieldsValid = requiredStringFields.every(field =>
        typeof (token as any)[field] === 'string' && (token as any)[field] !== ''
    );

    // Check number fields
    const numberFieldsValid = requiredNumberFields.every(field =>
        typeof (token as any)[field] === 'number' && !isNaN((token as any)[field])
    );

    return stringFieldsValid && numberFieldsValid;
}

// Test individual token price fetching
async function testIndividualTokenFetch() {
    console.log('\n📊 Testing individual token price fetching...');

    // Test with a known token (SOL)
    const solMint = '11111111111111111111111111111111';
    const token = await getTokenPrice(solMint);

    if (!token) {
        console.error('❌ Failed to fetch SOL token price!');
        return false;
    }

    console.log(`✅ Successfully fetched ${token.symbol} token price: ${formatPrice(token.current_price)}`);
    return true;
}

// Test fetching all tracked tokens
async function testAllTokensFetch() {
    console.log('\n📊 Testing fetching all tracked tokens...');

    const startTime = Date.now();
    const tokenPrices = await getAllTrackedTokenPrices();
    const duration = Date.now() - startTime;

    if (tokenPrices.length === 0) {
        console.error('❌ Failed to fetch any token prices!');
        return false;
    }

    console.log(`✅ Successfully fetched ${tokenPrices.length}/${TRACKED_TOKENS.length} tokens in ${duration}ms`);

    // Display all fetched tokens
    console.log('\n🪙 Token Prices:');
    console.log('-------------------------------------------');
    console.log('Symbol   | Price       | Name');
    console.log('-------------------------------------------');

    tokenPrices.forEach(token => {
        // Padding for nice output formatting
        const symbolPad = token.symbol.padEnd(8);
        const pricePad = formatPrice(token.current_price).padEnd(12);

        console.log(`${symbolPad}| ${pricePad}| ${token.name}`);
    });

    console.log('-------------------------------------------');

    // Check for any missing tokens
    const fetchedMints = new Set(tokenPrices.map(t => t.mint_address));
    const missingTokens = TRACKED_TOKENS.filter(mint => !fetchedMints.has(mint));

    if (missingTokens.length > 0) {
        console.warn(`⚠️ Warning: Failed to fetch ${missingTokens.length} tokens:`);
        console.warn(missingTokens.join(', '));
    }

    return tokenPrices.length > 0;
}

// Test token data structure validation
async function testTokenDataStructure() {
    console.log('\n🔍 Testing token data structure validation...');

    // Get token details for SOL which should be reliably available
    const tokenMap = await getTokenPrices(['11111111111111111111111111111111']);
    const solToken = tokenMap.get('11111111111111111111111111111111');

    if (!solToken) {
        console.error('❌ Failed to fetch SOL token details for structure validation!');
        return false;
    }

    const isValid = validateTokenStructure(solToken);

    if (isValid) {
        console.log('✅ Token data structure validation passed');

        // Print some key fields to verify
        console.log('\n📝 Token Details Sample (SOL):');
        console.log(`Symbol: ${solToken.symbol}`);
        console.log(`Name: ${solToken.name}`);
        console.log(`Current Price: ${formatPrice(solToken.price)}`);
        console.log(`24h Price: ${formatPrice(solToken.price1d)}`);
        console.log(`7d Price: ${formatPrice(solToken.price7d)}`);
        console.log(`24h Change: ${formatPercentage(calculatePriceChangePercent(solToken.price, solToken.price1d))}`);
        console.log(`7d Change: ${formatPercentage(calculatePriceChangePercent(solToken.price, solToken.price7d))}`);
        console.log(`Decimal Places: ${solToken.decimal}`);
        console.log(`Market Cap: $${solToken.marketCap.toLocaleString()}`);
        console.log(`24h Volume: $${solToken.usdValueVolume24h.toLocaleString()}`);
    } else {
        console.error('❌ Token data structure validation failed!');
        console.error('Received:', solToken);
    }

    return isValid;
}

// Test token verification
async function testTokenVerification() {
    console.log('\n🔍 Testing token verification...');

    // Test with valid token (SOL)
    const validTokenResult = await verifyToken('11111111111111111111111111111111');
    console.log(`Valid token (SOL) verification: ${validTokenResult ? '✅ Passed' : '❌ Failed'}`);

    // Test with invalid token (random string)
    const invalidTokenResult = await verifyToken('invalid_token_address_that_doesnt_exist');
    console.log(`Invalid token verification: ${!invalidTokenResult ? '✅ Passed' : '❌ Failed'}`);

    return validTokenResult && !invalidTokenResult;
}

// Test database integration
async function testDatabaseIntegration() {
    console.log('\n💾 Testing database integration...');

    // Initialize database connection
    const db = await initializeDatabase();

    // Get a token price
    const solToken = await getTokenPrice('11111111111111111111111111111111');

    if (!solToken) {
        console.error('❌ Failed to fetch token for database test!');
        return false;
    }

    // Try to store in database
    const result = await initializeTokenPriceCache(db, solToken);

    if (result) {
        console.log(`✅ Successfully stored ${solToken.symbol} token data in database`);
    } else {
        console.error('❌ Failed to store token data in database!');
    }

    return result;
}

// Test error handling
async function testErrorHandling() {
    console.log('\n⚠️ Testing error handling...');

    // Test with invalid token address
    try {
        await getTokenPrice('invalid_address');
        console.log('✅ Error handling test passed - did not throw exception for invalid token');
        return true;
    } catch (error) {
        console.error('❌ Error handling test failed - threw unhandled exception:', error);
        return false;
    }
}

// Run all tests
async function runAllTests() {
    console.log('🧪 Starting token price API integration tests...');

    // Track test results
    const results = {
        individualFetch: false,
        allTokens: false,
        dataStructure: false,
        verification: false,
        database: false,
        errorHandling: false
    };

    try {
        // Run tests
        results.individualFetch = await testIndividualTokenFetch();
        results.allTokens = await testAllTokensFetch();
        results.dataStructure = await testTokenDataStructure();
        results.verification = await testTokenVerification();
        results.database = await testDatabaseIntegration();
        results.errorHandling = await testErrorHandling();

        // Summarize results
        console.log('\n📋 Test Results Summary:');
        console.log('-------------------------------------------');
        Object.entries(results).forEach(([test, passed]) => {
            console.log(`${test.padEnd(20)}: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
        });
        console.log('-------------------------------------------');

        const passedCount = Object.values(results).filter(Boolean).length;
        const totalTests = Object.values(results).length;

        console.log(`Overall: ${passedCount}/${totalTests} tests passed`);

        if (passedCount === totalTests) {
            console.log('🎉 All tests passed! Token price API integration is working correctly.');
        } else {
            console.error(`⚠️ ${totalTests - passedCount} tests failed. Please review the issues above.`);
        }
    } catch (error) {
        console.error('❌ Unexpected error during testing:', error);
    }
}

// Run tests when executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('Unhandled error in tests:', error);
        process.exit(1);
    });
}
