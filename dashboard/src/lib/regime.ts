import type { RouteBreakdown, SymbolBreakdown } from './queries/observatory';

export interface DominantRegime {
  topSymbol: string;
  routes: Array<{ buyExchange: string; sellExchange: string; rawCandidates: number }>;
  sellSink: string | null;
  sourceVenues: string[];
  description: string;
}

/**
 * Rule-based "current dominant regime" detector — no LLM. The Overview page
 * uses this to render a narrative callout summarising the dataset the user
 * is staring at (e.g. "PYTH/USDT dislocations selling into MEXC across 4
 * source venues"). Returns null when no clear single-symbol regime exists.
 */
export function detectDominantRegime(
  symbols: SymbolBreakdown[],
  routes: RouteBreakdown[],
): DominantRegime | null {
  if (symbols.length === 0 || routes.length === 0) return null;
  const top = symbols[0];
  if (!top) return null;

  // Only call it a "dominant" regime when the leader has ≥ 50% of candidates
  // OR a 2x lead over the runner-up. Otherwise the dataset is too diffuse.
  const total = symbols.reduce((acc, s) => acc + s.rawCandidates, 0);
  const second = symbols[1]?.rawCandidates ?? 0;
  const dominant =
    total > 0 && (top.rawCandidates / total >= 0.5 || top.rawCandidates >= 2 * Math.max(second, 1));

  const symbolRoutes = routes
    .filter((r) => true) // route table is symbol-agnostic, but typical runs concentrate by symbol
    .slice(0, 5);

  if (!dominant || symbolRoutes.length === 0) return null;

  // Identify the "sink" — the sell venue that recurs across the top routes.
  const sinkCounts = new Map<string, number>();
  for (const r of symbolRoutes) {
    sinkCounts.set(r.sellExchange, (sinkCounts.get(r.sellExchange) ?? 0) + r.rawCandidates);
  }
  let sellSink: string | null = null;
  let bestSinkCount = 0;
  for (const [venue, count] of sinkCounts.entries()) {
    if (count > bestSinkCount) {
      sellSink = venue;
      bestSinkCount = count;
    }
  }

  const sourceVenues = symbolRoutes
    .filter((r) => r.sellExchange === sellSink)
    .map((r) => r.buyExchange);
  const uniqueSources = Array.from(new Set(sourceVenues));

  const description = sellSink
    ? `${top.symbol} dislocations selling into ${sellSink.toUpperCase()} across ` +
      `${uniqueSources.length} source ${uniqueSources.length === 1 ? 'venue' : 'venues'}` +
      (uniqueSources.length > 0 ? ` (${uniqueSources.join(', ')})` : '')
    : `${top.symbol} dominates raw candidates`;

  return {
    topSymbol: top.symbol,
    routes: symbolRoutes.slice(0, 5).map((r) => ({
      buyExchange: r.buyExchange,
      sellExchange: r.sellExchange,
      rawCandidates: r.rawCandidates,
    })),
    sellSink,
    sourceVenues: uniqueSources,
    description,
  };
}
