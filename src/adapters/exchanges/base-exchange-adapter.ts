import type { CexSymbol } from '../../core/types/market.js';
import type { NormalizedOrderBook } from '../../core/types/order-book.js';

/**
 * Minimal contract every CEX adapter must satisfy. Phase 1 only needs to read
 * order books. Trading methods are intentionally absent.
 */
export interface BaseExchangeAdapter {
  readonly id: string;            // canonical id, e.g. "binance"
  readonly name: string;          // display name

  /** Resolve once before scanning — confirms symbols, ticks, min sizes. */
  loadMarkets(): Promise<Set<CexSymbol>>;

  /** Fetch a fresh order book for a single symbol up to `depthLevels`. */
  fetchOrderBook(symbol: CexSymbol, depthLevels: number): Promise<NormalizedOrderBook>;
}
