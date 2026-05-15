/** (after - before) / before * 100. */
export function pctChange(before: number, after: number): number {
  if (before === 0) return 0;
  return ((after - before) / before) * 100;
}

/** Convert a decimal rate (0.001) to percent (0.1). */
export function rateToPct(rate: number): number {
  return rate * 100;
}

/** Round to N decimal places (numeric, not string). */
export function round(value: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

/** Cross-exchange gross spread, in percent. */
export function grossSpreadPct(buyTopAsk: number, sellTopBid: number): number {
  if (!Number.isFinite(buyTopAsk) || buyTopAsk <= 0) return 0;
  return ((sellTopBid - buyTopAsk) / buyTopAsk) * 100;
}

/**
 * Quick approximate net spread after fees — used as a cheap pre-filter before
 * the full depth simulation. Real net edge must come from
 * `simulateDepthExecution`, which accounts for slippage.
 */
export function approxNetSpreadPct(
  buyTopAsk: number,
  sellTopBid: number,
  buyTakerFeeRate: number,
  sellTakerFeeRate: number,
): number {
  return (
    grossSpreadPct(buyTopAsk, sellTopBid) -
    rateToPct(buyTakerFeeRate) -
    rateToPct(sellTakerFeeRate)
  );
}
