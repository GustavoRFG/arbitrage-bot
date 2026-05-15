import { PolymarketOrderBookAdapter } from '../../adapters/polymarket/polymarket-orderbook-adapter.js';

import type {
  PolymarketMarketSnapshot,
  PolymarketShortHorizonMarket,
} from '../../core/types/polymarket.js';

/**
 * Polls (or streams) the CLOB for one market.
 *
 * Phase 1 SKELETON: returns null until the underlying adapter is implemented.
 * The contract is in place so the orchestrator can be wired now.
 */
export class PolymarketClobCollector {
  constructor(private readonly adapter: PolymarketOrderBookAdapter) {}

  async fetchSnapshot(market: PolymarketShortHorizonMarket): Promise<PolymarketMarketSnapshot | null> {
    if (!market.yesTokenId || !market.noTokenId) return null;
    return this.adapter.fetchSnapshot({
      marketId: market.id,
      yesTokenId: market.yesTokenId,
      noTokenId: market.noTokenId,
    });
  }
}
