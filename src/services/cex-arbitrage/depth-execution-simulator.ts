import {
  walkBookByAmount,
  walkBookByNotional,
} from '../../core/math/weighted-average.js';

import type { NormalizedOrderBook } from '../../core/types/order-book.js';

export interface DepthSimulationInput {
  buyBook: NormalizedOrderBook;             // ladder we BUY from (use asks)
  sellBook: NormalizedOrderBook;            // ladder we SELL into (use bids)
  buyTakerFeeRate: number;
  sellTakerFeeRate: number;
  targetNotionalQuote: number;
}

export interface DepthSimulationResult {
  targetNotionalQuote: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  executableBuyNotional: number;
  executableSellNotional: number;
  supportedByDepth: boolean;
  grossProfitQuote: number;
  feesQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  /** True if there is positive net profit AND both legs filled at the target. */
  tradablePrefunded: boolean;
}

/**
 * Two-leg depth-aware simulation: buy `targetNotionalQuote` of base asset on
 * `buyBook` (consuming asks), then sell the acquired base on `sellBook`
 * (consuming bids). All quantities are at the venue's stated levels — this
 * does not model latency, partial fills or order-queue dynamics; that is
 * Phase 2's job.
 */
export function simulateDepthExecution(input: DepthSimulationInput): DepthSimulationResult {
  const buyWalk = walkBookByNotional(input.buyBook.asks, input.targetNotionalQuote);
  const sellWalk = walkBookByAmount(input.sellBook.bids, buyWalk.filledAmountBase);

  const grossProfitQuote = sellWalk.filledNotionalQuote - buyWalk.filledNotionalQuote;
  const feesQuote =
    buyWalk.filledNotionalQuote * input.buyTakerFeeRate +
    sellWalk.filledNotionalQuote * input.sellTakerFeeRate;
  const netProfitQuote = grossProfitQuote - feesQuote;
  const netSpreadPct =
    buyWalk.filledNotionalQuote > 0
      ? (netProfitQuote / buyWalk.filledNotionalQuote) * 100
      : 0;

  const supportedByDepth = buyWalk.filledFully && sellWalk.filledFully;
  const tradablePrefunded = supportedByDepth && netProfitQuote > 0;

  return {
    targetNotionalQuote: input.targetNotionalQuote,
    avgBuyPrice: buyWalk.averagePrice,
    avgSellPrice: sellWalk.averagePrice,
    executableBuyNotional: buyWalk.filledNotionalQuote,
    executableSellNotional: sellWalk.filledNotionalQuote,
    supportedByDepth,
    grossProfitQuote,
    feesQuote,
    netProfitQuote,
    netSpreadPct,
    tradablePrefunded,
  };
}
