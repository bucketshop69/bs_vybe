import { getAllTrackedWalletsWithState } from './db/database';
import { VybeWebSocketFilters, VybeTransferFilter, VybeTradeFilter, VybeOraclePriceFilter } from './services/vybeWebSocket';


export async function generateCurrentFilters(db: any): Promise<VybeWebSocketFilters> {
    console.log('[FilterService] Generating current WebSocket filters...');

    try {
        // --- Transfer Filters --- 
        const allWalletsState: Array<{ wallet_address: string, [key: string]: any }> = await getAllTrackedWalletsWithState(db);
        const uniqueWallets = [...new Set(allWalletsState.map((w: { wallet_address: string }) => w.wallet_address))];

        const transferFilters: VybeTransferFilter[] = uniqueWallets.flatMap(address => [
            { senderAddress: address },
            { receiverAddress: address }
        ]);
        console.log(`[FilterService] Generated ${transferFilters.length} transfer filters for ${uniqueWallets.length} unique wallets.`);


        const tradeFilters: VybeTradeFilter[] = []; // Default to empty with correct type
        console.log(`[FilterService] Trade filters are currently not implemented.`);

        const oraclePriceFilters: VybeOraclePriceFilter[] = []; // Default to empty
        console.log(`[FilterService] Oracle price filters are currently not implemented.`);


        const filters: Partial<VybeWebSocketFilters> = {
            transfers: transferFilters.length > 0 ? transferFilters : undefined,
            trades: tradeFilters.length > 0 ? tradeFilters : undefined,
            oraclePrices: oraclePriceFilters.length > 0 ? oraclePriceFilters : undefined, // Keep placeholder or set undefined
        };

        // Remove undefined keys
        Object.keys(filters).forEach(key => {
            const filterKey = key as keyof VybeWebSocketFilters;
            if (filters[filterKey] === undefined) {
                delete filters[filterKey];
            }
        });

        console.log('[FilterService] Generated filters:', JSON.stringify(filters));
        return filters as VybeWebSocketFilters;

    } catch (error) {
        console.error("[FilterService] Error generating filters:", error);
        // Return empty filters or re-throw based on desired error handling
        return {};
    }
} 