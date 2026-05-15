import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';

import type { PolymarketMarketSnapshot } from '../../core/types/polymarket.js';

const log = getLogger('poly.ws');

export type PolymarketWsHandler = (snap: PolymarketMarketSnapshot) => void;

/**
 * Public WebSocket subscription to the Polymarket CLOB `market` channel.
 *
 * Phase 1 SKELETON: outlines the contract. The live implementation should
 * open a WS to POLYMARKET_CLOB_WS_URL, subscribe with
 * `{ type: 'Market', assets_ids: [yesTokenId, noTokenId] }`, parse `book`
 * and `price_change` messages and call the handler with normalised snapshots.
 *
 * Reference: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
 */
export class PolymarketMarketWsAdapter {
  private readonly url: string;

  constructor(url?: string) {
    this.url = url ?? getAppConfig().POLYMARKET_CLOB_WS_URL;
  }

  async subscribe(_assets: string[], _handler: PolymarketWsHandler): Promise<() => void> {
    log.warn({ url: this.url }, 'PolymarketMarketWsAdapter.subscribe() is a P3 skeleton — no-op');
    // TODO(phase-1.B): open ws, send subscription, parse messages, call handler.
    return () => undefined;
  }
}
