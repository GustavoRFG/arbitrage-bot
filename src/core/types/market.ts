/**
 * Where a price comes from. Phase 1 covers two kinds: centralised exchanges
 * (CEX) and prediction markets (Polymarket). The shared abstraction lets the
 * persistence and reporting layers stay venue-agnostic.
 */
export interface MarketVenue {
  id: string;                            // e.g. "binance", "polymarket"
  kind: 'cex' | 'prediction_market';
  name: string;                          // human-friendly: "Binance", "Polymarket"
}

/** Common CEX symbol shape used across adapters: BASE/QUOTE in upper case. */
export type CexSymbol = string;          // e.g. "BTC/USDT"

export function parseCexSymbol(symbol: CexSymbol): { base: string; quote: string } {
  const [base, quote] = symbol.split('/');
  if (!base || !quote) {
    throw new Error(`Invalid CEX symbol "${symbol}" (expected BASE/QUOTE).`);
  }
  return { base, quote };
}
