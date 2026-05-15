import { getLogger } from '../../core/logger/logger.js';

import type { CryptoReferenceSnapshot } from '../../core/types/polymarket.js';

const log = getLogger('poly.rtds');

export type ReferenceFeedHandler = (snap: CryptoReferenceSnapshot) => void;

/**
 * Real-time crypto reference price feed (Polymarket-style RTDS / Binance WS /
 * Chainlink), used to time-align the CLOB against the underlying.
 *
 * Phase 1 SKELETON: outlines the contract. The live implementation should
 *  - Binance: subscribe to `${asset.toLowerCase()}usdt@trade` on the public
 *    WS gateway and convert each trade into a CryptoReferenceSnapshot.
 *  - Chainlink: read the on-chain feed via a public RPC; for Phase 1 we may
 *    consume an off-chain aggregator that mirrors the feed at higher cadence.
 */
export class PolymarketRtdsAdapter {
  async subscribeBinance(_asset: string, _handler: ReferenceFeedHandler): Promise<() => void> {
    log.warn('PolymarketRtdsAdapter.subscribeBinance() is a P3 skeleton — no-op');
    return () => undefined;
  }

  async subscribeChainlink(_asset: string, _handler: ReferenceFeedHandler): Promise<() => void> {
    log.warn('PolymarketRtdsAdapter.subscribeChainlink() is a P3 skeleton — no-op');
    return () => undefined;
  }
}
