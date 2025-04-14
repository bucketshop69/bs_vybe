import dotenv from 'dotenv';
dotenv.config();

import * as db from '../src/database';
import { initializeTokenPrices, startTokenPriceService, stopTokenPriceService, simulatePriceChange } from '../src/tokenPriceService';
import { initializeTokenAlerts, sendTestPriceAlerts, stopNotificationSystem } from '../src/tokenAlerts';
import { TRACKED_TOKENS } from '../src/config';

// Test configuration
const TEST_USER_ID = process.env.TELEGRAM_CHAT_ID ? parseInt(process.env.TELEGRAM_CHAT_ID) : 123456789; // Use admin ID or fallback
const SOL_MINT = '11111111111111111111111111111111'; // SOL
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK

// Timeout utilities
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Test harness
async function runTest() {
    console.log('==========================================');
    console.log('TOKEN ALERT SYSTEM TEST');
    console.log('==========================================');

    try {
        // Initialize database connection
        console.log('Initializing database connection...');
        const database = await db.initializeDatabase(); // Use the proper initialization function

        // Step 1: Initialize token prices
        console.log('\n[TEST] Initializing token prices');
        const pricesInitialized = await initializeTokenPrices(database);
        if (!pricesInitialized) {
            throw new Error('Failed to initialize token prices');
        }
        console.log('✅ Token prices initialized successfully');

        // Step 2: Initialize token alerts
        console.log('\n[TEST] Initializing token alert system');
        initializeTokenAlerts();
        console.log('✅ Token alert system initialized');

        // Step 3: Send test alerts
        console.log(`\n[TEST] Sending test alerts to user ID: ${TEST_USER_ID}`);
        const tokens = await db.getAllTokenPrices(database);
        if (tokens.length === 0) {
            throw new Error('No tokens found in database');
        }

        // Find SOL token for testing
        const solToken = tokens.find(t => t.mint_address === SOL_MINT);
        if (!solToken) {
            throw new Error('SOL token not found in database');
        }

        // Add a test user to the database
        await database.run(
            'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
            [TEST_USER_ID]
        );

        // Subscribe test user to token alerts for proper testing
        await db.subscribeToTokenAlerts(database, TEST_USER_ID, SOL_MINT);
        await db.subscribeToTokenAlerts(database, TEST_USER_ID, BONK_MINT);
        console.log(`✅ Subscribed test user ${TEST_USER_ID} to SOL and BONK alerts`);

        // Send test alerts
        await sendTestPriceAlerts(TEST_USER_ID, solToken);
        console.log('✅ Test alerts sent');
        await wait(2000); // Wait for notifications to process

        // Step 4: Simulate price changes
        console.log('\n[TEST] Simulating price changes');

        // First test: Small price change (below threshold)
        console.log('\n[TEST] Small price change (2% increase)');
        await simulatePriceChange(database, SOL_MINT, 2);
        console.log('Waiting for alert processing...');
        await wait(2000);
        console.log('✅ Small price change test complete - no alerts should be sent');

        // Second test: Price change above threshold
        console.log('\n[TEST] Significant price change (5% increase)');
        await simulatePriceChange(database, SOL_MINT, 5);
        console.log('Waiting for alert processing...');
        await wait(2000);
        console.log('✅ Significant price change test complete - alerts should be sent');

        // Third test: Large price crash
        console.log('\n[TEST] Price crash (-10% decrease)');
        await simulatePriceChange(database, BONK_MINT, -10);
        console.log('Waiting for alert processing...');
        await wait(2000);
        console.log('✅ Price crash test complete - alerts should be sent');

        // Step 5: Test alert throttling
        console.log('\n[TEST] Testing alert throttling');
        console.log('Making multiple price changes to test throttling...');

        // Multiple changes in rapid succession
        for (let i = 0; i < 3; i++) {
            await simulatePriceChange(database, SOL_MINT, 4);
            await wait(500);
        }

        console.log('Waiting for alert processing...');
        await wait(2000);
        console.log('✅ Throttling test complete - only first alert should be sent');

        // Cleanup
        console.log('\n[TEST] Cleaning up...');
        stopTokenPriceService();
        stopNotificationSystem();
        console.log('✅ Services stopped');

        console.log('\n==========================================');
        console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY');
        console.log('==========================================');
        console.log('\nPlease check your Telegram app to verify you received the expected notifications:');
        console.log('1. Two test alerts (general and target)');
        console.log('2. Alert for 5% SOL price increase');
        console.log('3. Alert for 10% BONK price decrease');
        console.log('4. Only one alert for the throttling test (not 3)');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
    } finally {
        // Ensure services are stopped
        stopTokenPriceService();
        stopNotificationSystem();

        // Exit after tests
        setTimeout(() => {
            console.log('Exiting test harness');
            process.exit(0);
        }, 1000);
    }
}

// Run the tests
runTest().catch(error => {
    console.error('Fatal error in test harness:', error);
    process.exit(1);
}); 