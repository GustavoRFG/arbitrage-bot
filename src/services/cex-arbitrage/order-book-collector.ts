import { getLogger } from '../../core/logger/logger.js';

import type { BaseExchangeAdapter } from '../../adapters/exchanges/base-exchange-adapter.js';
import type { CexSymbol } from '../../core/types/market.js';
import type { NormalizedOrderBook } from '../../core/types/order-book.js';

const log = getLogger('cex.collector');

export interface SymbolBooks {
  symbol: CexSymbol;
  books: { venue: string; book: NormalizedOrderBook }[];
}

/**
 * Pulls the latest order book for every (exchange, symbol) we monitor. Errors
 * on individual fetches are logged and skipped — a single venue going down
 * must not stop the rest of the scan.
 */
export class OrderBookCollector {
  constructor(
    private readonly adapters: BaseExchangeAdapter[],
    private readonly symbols: CexSymbol[],
    private readonly depthLevels: number,
    /** Optional restriction: only fetch <symbol, venue> pairs the venue actually lists. */
    private readonly supportedSymbolsByVenue?: Map<string, Set<CexSymbol>>,
  ) {}

  async collectAll(): Promise<SymbolBooks[]> {
    const results: SymbolBooks[] = [];
    for (const symbol of this.symbols) {
      const tasks = this.adapters
        .filter((a) => {
          const supported = this.supportedSymbolsByVenue?.get(a.id);
          return !supported || supported.has(symbol);
        })
        .map(async (a) => {
          try {
            const book = await a.fetchOrderBook(symbol, this.depthLevels);
            return { venue: a.id, book };
          } catch (err) {
            log.debug({ venue: a.id, symbol, err: (err as Error).message }, 'fetch failed');
            return null;
          }
        });
      const settled = (await Promise.all(tasks)).filter(
        (r): r is { venue: string; book: NormalizedOrderBook } => r !== null,
      );
      results.push({ symbol, books: settled });
    }
    return results;
  }
}
