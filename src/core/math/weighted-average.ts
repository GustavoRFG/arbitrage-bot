import type { OrderBookLevel } from '../types/order-book.js';

export interface DepthWalkResult {
  filledNotionalQuote: number;
  filledAmountBase: number;
  averagePrice: number;
  /** True if the walk filled the requested target notional in full. */
  filledFully: boolean;
  levelsConsumed: number;
}

/**
 * Walk an *asks* (or *bids*) ladder to fill `targetNotionalQuote` worth of
 * quote currency. Stops at the first level where the cumulative notional
 * meets or exceeds the target, partially consuming that level.
 *
 * Returns the volume-weighted average price and whether the target was met.
 * Empty ladders yield a zero result with `filledFully=false`.
 */
export function walkBookByNotional(
  levels: OrderBookLevel[],
  targetNotionalQuote: number,
): DepthWalkResult {
  if (targetNotionalQuote <= 0 || levels.length === 0) {
    return {
      filledNotionalQuote: 0,
      filledAmountBase: 0,
      averagePrice: 0,
      filledFully: targetNotionalQuote <= 0,
      levelsConsumed: 0,
    };
  }

  let remainingQuote = targetNotionalQuote;
  let filledNotional = 0;
  let filledAmount = 0;
  let levelsConsumed = 0;

  for (const level of levels) {
    levelsConsumed++;
    const levelNotional = level.notionalQuote;
    if (levelNotional >= remainingQuote) {
      const takeQuote = remainingQuote;
      const takeAmount = takeQuote / level.price;
      filledNotional += takeQuote;
      filledAmount += takeAmount;
      remainingQuote = 0;
      break;
    }
    filledNotional += levelNotional;
    filledAmount += level.amountBaseOrShares;
    remainingQuote -= levelNotional;
  }

  const filledFully = remainingQuote <= 0;
  const averagePrice = filledAmount > 0 ? filledNotional / filledAmount : 0;

  return {
    filledNotionalQuote: filledNotional,
    filledAmountBase: filledAmount,
    averagePrice,
    filledFully,
    levelsConsumed,
  };
}

/**
 * Walk a *bids* ladder to *sell* `targetAmountBase` worth of base asset.
 * Used for the sell leg after the buy leg told us how much base we acquired.
 */
export function walkBookByAmount(
  bids: OrderBookLevel[],
  targetAmountBase: number,
): DepthWalkResult {
  if (targetAmountBase <= 0 || bids.length === 0) {
    return {
      filledNotionalQuote: 0,
      filledAmountBase: 0,
      averagePrice: 0,
      filledFully: targetAmountBase <= 0,
      levelsConsumed: 0,
    };
  }

  let remainingAmount = targetAmountBase;
  let filledNotional = 0;
  let filledAmount = 0;
  let levelsConsumed = 0;

  for (const level of bids) {
    levelsConsumed++;
    if (level.amountBaseOrShares >= remainingAmount) {
      const takeAmount = remainingAmount;
      const takeNotional = takeAmount * level.price;
      filledNotional += takeNotional;
      filledAmount += takeAmount;
      remainingAmount = 0;
      break;
    }
    filledNotional += level.notionalQuote;
    filledAmount += level.amountBaseOrShares;
    remainingAmount -= level.amountBaseOrShares;
  }

  const filledFully = remainingAmount <= 0;
  const averagePrice = filledAmount > 0 ? filledNotional / filledAmount : 0;

  return {
    filledNotionalQuote: filledNotional,
    filledAmountBase: filledAmount,
    averagePrice,
    filledFully,
    levelsConsumed,
  };
}
