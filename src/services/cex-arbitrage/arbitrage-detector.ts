import { approxNetSpreadPct, grossSpreadPct } from '../../core/math/percent.js';
import { isStale } from '../../core/types/timestamps.js';
import {
  simulateDepthExecution,
  type DepthSimulationResult,
} from './depth-execution-simulator.js';

import type { NormalizedOrderBook } from '../../core/types/order-book.js';
import type { FeeResolver } from './fee-resolver.js';

export interface DetectorThresholds {
  minGrossSpreadPct: number;
  minApproxNetSpreadPct: number;
  minExecutableNetSpreadPct: number;
  minNetProfitQuote: number;
  maxBookStalenessMs: number;
  targetNotionals: number[];
}

export interface BookByVenue {
  venue: string;
  book: NormalizedOrderBook;
}

export interface CexArbitrageCandidate {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyTopAsk: number;
  sellTopBid: number;
  grossSpreadPct: number;
  approxNetSpreadPct: number;
  detectedAtMs: number;
  estimates: DepthSimulationResult[];
  /** True if at least one estimate clears all configured thresholds. */
  isMaterial: boolean;
}

/**
 * For one symbol, compare every (buyVenue, sellVenue) ordered pair across the
 * provided books and emit candidates that pass the gross-spread filter.
 *
 * Stale books and books missing a top-of-book level are skipped silently.
 */
export class ArbitrageDetector {
  constructor(
    private readonly fees: FeeResolver,
    private readonly thresholds: DetectorThresholds,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  detect(symbol: string, booksByVenue: BookByVenue[]): CexArbitrageCandidate[] {
    const candidates: CexArbitrageCandidate[] = [];
    const t = this.thresholds;
    const now = this.nowMs();

    const usable = booksByVenue.filter(
      (b) =>
        !isStale(b.book.timestamps, t.maxBookStalenessMs, now) &&
        b.book.asks.length > 0 &&
        b.book.bids.length > 0,
    );

    for (let i = 0; i < usable.length; i++) {
      for (let j = 0; j < usable.length; j++) {
        if (i === j) continue;
        const buy = usable[i]!;
        const sell = usable[j]!;
        const buyTopAsk = buy.book.asks[0]!.price;
        const sellTopBid = sell.book.bids[0]!.price;

        const gross = grossSpreadPct(buyTopAsk, sellTopBid);
        if (gross < t.minGrossSpreadPct) continue;

        const buyFee = this.fees.takerFeeRate(buy.venue);
        const sellFee = this.fees.takerFeeRate(sell.venue);
        const approx = approxNetSpreadPct(buyTopAsk, sellTopBid, buyFee, sellFee);
        if (approx < t.minApproxNetSpreadPct) continue;

        const estimates: DepthSimulationResult[] = [];
        let isMaterial = false;
        for (const target of t.targetNotionals) {
          const est = simulateDepthExecution({
            buyBook: buy.book,
            sellBook: sell.book,
            buyTakerFeeRate: buyFee,
            sellTakerFeeRate: sellFee,
            targetNotionalQuote: target,
          });
          estimates.push(est);
          if (
            est.supportedByDepth &&
            est.netProfitQuote >= t.minNetProfitQuote &&
            est.netSpreadPct >= t.minExecutableNetSpreadPct
          ) {
            isMaterial = true;
          }
        }

        candidates.push({
          symbol,
          buyExchange: buy.venue,
          sellExchange: sell.venue,
          buyTopAsk,
          sellTopBid,
          grossSpreadPct: gross,
          approxNetSpreadPct: approx,
          detectedAtMs: now,
          estimates,
          isMaterial,
        });
      }
    }

    return candidates;
  }
}
