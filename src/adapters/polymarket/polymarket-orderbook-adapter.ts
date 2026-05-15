import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';

import type { PolymarketMarketSnapshot } from '../../core/types/polymarket.js';

const log = getLogger('poly.orderbook');

/**
 * Fetch a CLOB snapshot for one market (YES + NO sides).
 *
 * Phase 1 SKELETON: outlines the contract. Live REST call should hit the
 * official CLOB at `${clobUrl}/book?token_id=...` for each side and combine
 * them into a single PolymarketMarketSnapshot. WebSocket subscription
 * (`market` channel) is preferred for steady-state observation; see
 * PolymarketMarketWsAdapter.
 *
 * Reference: https://docs.polymarket.com/developers/CLOB/clob-overview
 */
export class PolymarketOrderBookAdapter {
  private readonly clobUrl: string;

  constructor(clobUrl?: string) {
    this.clobUrl = clobUrl ?? getAppConfig().POLYMARKET_CLOB_API_URL;
  }

  async fetchSnapshot(args: {
    marketId: string;
    yesTokenId: string;
    noTokenId: string;
  }): Promise<PolymarketMarketSnapshot | null> {
    log.warn(
      { clobUrl: this.clobUrl, marketId: args.marketId },
      'PolymarketOrderBookAdapter.fetchSnapshot() is a P3 skeleton — returning null',
    );
    // TODO(phase-1.B): GET `${clobUrl}/book?token_id=${yesTokenId}` and
    // `${clobUrl}/book?token_id=${noTokenId}`. Compute best bid/ask, midpoint,
    // spread, depth top-N. Set capturedAtMs from local clock and source ts
    // from the response if present.
    return null;
  }
}
