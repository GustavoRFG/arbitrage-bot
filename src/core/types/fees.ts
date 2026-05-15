/**
 * Per-exchange fee model used by the CEX arbitrage observatory. Phase 1
 * defaults to taker fees because a passive fill is not guaranteed when an
 * arbitrage window is open. VIP tiers are out of scope but the shape is
 * here so the calculator never has to learn about them later.
 */
export interface CexFeeModel {
  exchange: string;
  marketType: 'spot';
  makerFeeRate: number;        // decimal, e.g. 0.001 = 0.1 %
  takerFeeRate: number;        // decimal
  source: 'config' | 'api' | 'manual';
  updatedAtMs: number;
}

/** Conservative fallback if a venue is not configured. */
export const DEFAULT_FALLBACK_TAKER_FEE = 0.002;
