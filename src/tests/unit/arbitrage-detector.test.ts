import { describe, expect, it } from 'vitest';

import { ArbitrageDetector } from '../../services/cex-arbitrage/arbitrage-detector.js';
import { FeeResolver } from '../../services/cex-arbitrage/fee-resolver.js';

import type { OrderBookLevel } from '../../core/types/order-book.js';

function book(
  venue: string,
  asks: [number, number][],
  bids: [number, number][],
  receivedAtMs = Date.now(),
) {
  const toLevels = (rows: [number, number][]): OrderBookLevel[] =>
    rows.map(([p, a]) => ({ price: p, amountBaseOrShares: a, notionalQuote: p * a }));
  return {
    venue,
    book: {
      venue,
      symbolOrMarketId: 'BTC/USDT',
      asks: toLevels(asks),
      bids: toLevels(bids),
      timestamps: { receivedAtMs },
    },
  };
}

const thresholds = {
  minGrossSpreadPct: 0,
  minApproxNetSpreadPct: -100,
  minExecutableNetSpreadPct: -100,
  minNetProfitQuote: 0,
  maxBookStalenessMs: 5_000,
  targetNotionals: [100, 500],
};

describe('ArbitrageDetector', () => {
  const fees = new FeeResolver();
  const detector = new ArbitrageDetector(fees, thresholds, () => Date.now());

  it('finds two-leg candidates when prices cross', () => {
    const a = book('binance', [[100, 5]], [[99.9, 5]]);
    const b = book('gateio', [[100.5, 5]], [[100.4, 5]]); // sell on b at 100.4 > buy on a at 100
    const candidates = detector.detect('BTC/USDT', [a, b]);
    expect(candidates.length).toBeGreaterThan(0);
    const buyAsell = candidates.find(
      (c) => c.buyExchange === 'binance' && c.sellExchange === 'gateio',
    );
    expect(buyAsell).toBeDefined();
    expect(buyAsell!.grossSpreadPct).toBeGreaterThan(0);
  });

  it('skips stale books', () => {
    const fresh = book('binance', [[100, 5]], [[99.9, 5]]);
    const stale = book('gateio', [[100.5, 5]], [[100.4, 5]], Date.now() - 60_000);
    const candidates = detector.detect('BTC/USDT', [fresh, stale]);
    expect(candidates.length).toBe(0);
  });

  it('emits a candidate even with negative net spread (we record everything for audit)', () => {
    const a = book('binance', [[100, 5]], [[99.9, 5]]);
    const b = book('gateio', [[100.01, 5]], [[100.005, 5]]);
    const candidates = detector.detect('BTC/USDT', [a, b]);
    // gross > 0 still emits; the estimates record whether it is materially executable.
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('marks isMaterial=false when depth cannot fill the smallest target', () => {
    const a = book('binance', [[100, 0.001]], [[99.9, 0.001]]); // very thin
    const b = book('gateio', [[100.5, 0.001]], [[100.4, 0.001]]);
    const candidates = detector.detect('BTC/USDT', [a, b]);
    for (const c of candidates) {
      expect(c.isMaterial).toBe(false);
    }
  });
});
