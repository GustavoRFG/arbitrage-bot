/**
 * Detector outputs are *candidates* — point-in-time observations of a possible
 * inefficiency. Lifecycles aggregate candidates with the same identity into a
 * single episode.
 */
export type CexArbitrageEventKey =
  `cex:${string}:${string}:${string}`;     // cex:<symbol>:<buyEx>:<sellEx>

export type PolymarketLagEventKey =
  `poly:${string}:${string}`;              // poly:<marketId>:<eventType>

export type EventKey = CexArbitrageEventKey | PolymarketLagEventKey;

export function cexArbitrageKey(
  symbol: string,
  buyExchange: string,
  sellExchange: string,
): CexArbitrageEventKey {
  return `cex:${symbol}:${buyExchange}:${sellExchange}`;
}

export function polymarketLagKey(
  marketId: string,
  eventType: string,
): PolymarketLagEventKey {
  return `poly:${marketId}:${eventType}`;
}
