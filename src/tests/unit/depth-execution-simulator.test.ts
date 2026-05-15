import { describe, expect, it } from 'vitest';

import {
  walkBookByAmount,
  walkBookByNotional,
} from '../../core/math/weighted-average.js';
import {
  simulateDepthExecution,
  type DepthSimulationInput,
} from '../../services/cex-arbitrage/depth-execution-simulator.js';
import type {
  NormalizedOrderBook,
  OrderBookLevel,
} from '../../core/types/order-book.js';

function lvl(price: number, amount: number): OrderBookLevel {
  return { price, amountBaseOrShares: amount, notionalQuote: price * amount };
}

function book(side: 'asks' | 'bids', levels: OrderBookLevel[]): NormalizedOrderBook {
  return {
    venue: 'test',
    symbolOrMarketId: 'X/USDT',
    bids: side === 'bids' ? levels : [],
    asks: side === 'asks' ? levels : [],
    timestamps: { receivedAtMs: Date.now() },
  };
}

describe('walkBookByNotional', () => {
  it('fills fully when first level covers the target', () => {
    const r = walkBookByNotional([lvl(100, 5)], 200); // 200 quote at price 100 = 2 base
    expect(r.filledFully).toBe(true);
    expect(r.filledNotionalQuote).toBe(200);
    expect(r.filledAmountBase).toBe(2);
    expect(r.averagePrice).toBe(100);
  });

  it('walks multiple levels and computes weighted average', () => {
    // 1 BTC at 100 = 100 quote, then 0.5 BTC at 110 = 55 quote -> total 155 quote, 1.5 base
    const r = walkBookByNotional([lvl(100, 1), lvl(110, 0.5)], 155);
    expect(r.filledFully).toBe(true);
    expect(r.filledAmountBase).toBeCloseTo(1.5, 8);
    expect(r.averagePrice).toBeCloseTo(155 / 1.5, 6);
  });

  it('returns supportedByDepth=false on shallow book', () => {
    const r = walkBookByNotional([lvl(100, 0.1)], 200); // only 10 quote available
    expect(r.filledFully).toBe(false);
    expect(r.filledNotionalQuote).toBe(10);
  });

  it('handles empty book safely', () => {
    const r = walkBookByNotional([], 100);
    expect(r.filledFully).toBe(false);
    expect(r.filledNotionalQuote).toBe(0);
    expect(r.averagePrice).toBe(0);
  });

  it('treats zero target as a no-op success', () => {
    const r = walkBookByNotional([lvl(100, 1)], 0);
    expect(r.filledFully).toBe(true);
    expect(r.filledNotionalQuote).toBe(0);
  });
});

describe('walkBookByAmount', () => {
  it('walks bids to sell base amount', () => {
    const r = walkBookByAmount([lvl(101, 1), lvl(100, 1)], 1.5);
    // 1 BTC at 101 = 101, then 0.5 BTC at 100 = 50 -> 151 quote
    expect(r.filledFully).toBe(true);
    expect(r.filledNotionalQuote).toBeCloseTo(151, 6);
    expect(r.averagePrice).toBeCloseTo(151 / 1.5, 6);
  });
});

describe('simulateDepthExecution', () => {
  const baseInput: Omit<DepthSimulationInput, 'targetNotionalQuote'> = {
    buyBook: book('asks', [lvl(100, 1), lvl(101, 1)]),
    sellBook: book('bids', [lvl(102, 2)]),
    buyTakerFeeRate: 0.001,
    sellTakerFeeRate: 0.001,
  };

  it('produces positive netProfit when sellBid > buyAsk and fees are small', () => {
    // Buy 100 quote at 100 -> 1 BTC; sell 1 BTC at 102 -> 102 quote.
    const r = simulateDepthExecution({ ...baseInput, targetNotionalQuote: 100 });
    expect(r.supportedByDepth).toBe(true);
    expect(r.grossProfitQuote).toBeCloseTo(2, 6);
    expect(r.feesQuote).toBeCloseTo(100 * 0.001 + 102 * 0.001, 6);
    expect(r.netProfitQuote).toBeCloseTo(2 - (0.1 + 0.102), 6);
    expect(r.tradablePrefunded).toBe(true);
  });

  it('flags tradablePrefunded=false when depth is missing', () => {
    const shallow: DepthSimulationInput = {
      ...baseInput,
      sellBook: book('bids', [lvl(102, 0.5)]),
      targetNotionalQuote: 200, // we'll buy 2 BTC but can only sell 0.5 BTC
    };
    const r = simulateDepthExecution(shallow);
    expect(r.supportedByDepth).toBe(false);
    expect(r.tradablePrefunded).toBe(false);
  });

  it('flags tradablePrefunded=false when net profit is negative', () => {
    const expensive: DepthSimulationInput = {
      ...baseInput,
      buyTakerFeeRate: 0.05, // 5% — eats the spread
      sellTakerFeeRate: 0.05,
      targetNotionalQuote: 100,
    };
    const r = simulateDepthExecution(expensive);
    expect(r.netProfitQuote).toBeLessThan(0);
    expect(r.tradablePrefunded).toBe(false);
  });

  it('handles empty books safely', () => {
    const r = simulateDepthExecution({
      ...baseInput,
      buyBook: book('asks', []),
      sellBook: book('bids', []),
      targetNotionalQuote: 100,
    });
    expect(r.supportedByDepth).toBe(false);
    expect(r.netProfitQuote).toBe(0);
  });
});
