import { getLogger } from '../../core/logger/logger.js';
import { freshTimestamps } from '../../core/types/timestamps.js';

import type { CryptoReferenceSnapshot } from '../../core/types/polymarket.js';

const log = getLogger('poly.refeed');

/**
 * Lightweight reference price client. Phase 1 starts with a Binance public
 * REST `ticker/price` poll (no auth, no signature) so the rest of the
 * pipeline has *something* to feed into the lag detector. The architecture
 * leaves room for the WebSocket / RTDS adapters in later phases.
 */
export class CryptoReferenceFeedService {
  /** Pull a single Binance spot price (e.g. asset='BTC' -> BTCUSDT). */
  async fetchBinanceSpot(asset: string): Promise<CryptoReferenceSnapshot | null> {
    const symbol = `${asset.toUpperCase()}USDT`;
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        log.debug({ status: res.status, url }, 'binance ticker non-2xx');
        return null;
      }
      const j = (await res.json()) as { price?: string };
      const price = j.price === undefined ? NaN : Number(j.price);
      if (!Number.isFinite(price) || price <= 0) return null;
      const ts = freshTimestamps();
      ts.processedAtMs = Date.now();
      return { asset: asset.toUpperCase(), source: 'binance', price, timestamps: ts };
    } catch (err) {
      log.debug({ err: (err as Error).message }, 'binance ticker fetch failed');
      return null;
    }
  }

  // Chainlink: deferred to Phase 2 — needs an RPC provider URL and a contract
  // ABI / aggregator address. The shape is here so the lag detector already
  // accepts a chainlink feed when wired.
  async fetchChainlink(_asset: string): Promise<CryptoReferenceSnapshot | null> {
    return null;
  }
}
