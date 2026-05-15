import ccxt, { type Exchange } from 'ccxt';

import { freshTimestamps } from '../../core/types/timestamps.js';

import type { CexSymbol } from '../../core/types/market.js';
import type {
  NormalizedOrderBook,
  OrderBookLevel,
} from '../../core/types/order-book.js';
import type { BaseExchangeAdapter } from './base-exchange-adapter.js';

/**
 * Generic CCXT-backed adapter. Phase 1 uses CCXT REST as the lowest-friction
 * path to read book data from many venues with one code path. The architecture
 * keeps room for native WebSocket adapters per exchange when latency starts to
 * matter (Phase 2 / 3).
 */
export class CcxtExchangeAdapter implements BaseExchangeAdapter {
  readonly id: string;
  readonly name: string;

  private readonly exchange: Exchange;
  private marketsLoaded = false;

  constructor(id: string, displayName?: string) {
    const ExchangeCtor = (ccxt as unknown as Record<string, new (config: object) => Exchange>)[id];
    if (!ExchangeCtor) {
      throw new Error(`CCXT does not support exchange id "${id}".`);
    }
    this.id = id;
    this.name = displayName ?? id;
    this.exchange = new ExchangeCtor({
      enableRateLimit: true,
      timeout: 15_000,
      // No keys: Phase 1 is read-only. CCXT public endpoints work without auth.
    });
  }

  async loadMarkets(): Promise<Set<CexSymbol>> {
    const markets = await this.exchange.loadMarkets();
    this.marketsLoaded = true;
    return new Set(Object.keys(markets));
  }

  async fetchOrderBook(symbol: CexSymbol, depthLevels: number): Promise<NormalizedOrderBook> {
    if (!this.marketsLoaded) await this.loadMarkets();

    const raw = await this.exchange.fetchOrderBook(symbol, depthLevels);
    const ts = freshTimestamps(raw.timestamp ?? undefined);

    const bids = toLevels(raw.bids ?? []);
    const asks = toLevels(raw.asks ?? []);
    ts.processedAtMs = Date.now();

    return {
      venue: this.id,
      symbolOrMarketId: symbol,
      bids,
      asks,
      timestamps: ts,
    };
  }
}

function toLevels(raw: (number | undefined)[][]): OrderBookLevel[] {
  const out: OrderBookLevel[] = [];
  for (const row of raw) {
    const price = row[0];
    const amount = row[1];
    if (price === undefined || amount === undefined) continue;
    if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) continue;
    out.push({ price, amountBaseOrShares: amount, notionalQuote: price * amount });
  }
  return out;
}
