/**
 * Phase 2.1 — top-N report helpers.
 *
 * These are pure functions over a `PaperSimulationResult` + the matching
 * `MissedOpportunityReport`. They emit ranked lists for the comparison
 * report:
 *   - top executed trades (by netProfitQuote)
 *   - top missed trades (by estimatedMissedProfitQuote)
 *   - top routes by paper PnL
 *   - top routes by missed PnL
 *   - top symbols by inventory efficiency (paper PnL / base notional traded)
 *
 * Sorting is stable across machines: each comparator falls back to
 * lifecycleId/detectedAtMs so two identical-value entries always sort the
 * same way.
 */

import { parseSymbol } from './paper-trade-types.js';

import type { MissedEntry, MissedOpportunityReport } from './missed-opportunity-accounting.js';
import type { PaperArbitrageTrade, PaperSimulationResult } from './paper-trade-types.js';

export interface TopExecutedTrade {
  lifecycleId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  netProfitQuote: number;
  netSpreadPct: number;
  executedAtMs: number;
}

export interface TopMissedTrade {
  lifecycleId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  detectedAtMs: number;
  reason: MissedEntry['reason'];
  estimatedMissedProfitQuote: number;
}

export interface RouteAggregate {
  buyVenue: string;
  sellVenue: string;
  trades: number;
  totalQuote: number;
}

export interface SymbolInventoryEfficiency {
  symbol: string;
  trades: number;
  totalNetProfitQuote: number;
  /** Sum of base units consumed across executed trades for this symbol. */
  totalBaseQty: number;
  /** Net profit per base unit (quote / base). 0 when no trades or zero base qty. */
  profitPerBase: number;
}

function compareDescThenStable<T>(
  arr: T[],
  primary: (x: T) => number,
  stable: (x: T) => number,
): T[] {
  return arr.slice().sort((a, b) => {
    const da = primary(a);
    const db = primary(b);
    if (da !== db) return db - da;
    return stable(a) - stable(b);
  });
}

export function topExecutedTrades(
  result: PaperSimulationResult,
  limit = 10,
): TopExecutedTrade[] {
  const sorted = compareDescThenStable(
    result.trades,
    (t) => t.netProfitQuote,
    (t) => t.lifecycleId,
  );
  return sorted.slice(0, limit).map((t) => ({
    lifecycleId: t.lifecycleId,
    symbol: t.symbol,
    buyVenue: t.buyVenue,
    sellVenue: t.sellVenue,
    netProfitQuote: t.netProfitQuote,
    netSpreadPct: t.netSpreadPct,
    executedAtMs: t.executedAtMs,
  }));
}

export function topMissedTrades(
  missed: MissedOpportunityReport,
  limit = 10,
): TopMissedTrade[] {
  const sorted = compareDescThenStable(
    missed.entries,
    (e) => e.estimatedMissedProfitQuote,
    (e) => e.lifecycleId,
  );
  return sorted.slice(0, limit).map((e) => ({
    lifecycleId: e.lifecycleId,
    symbol: e.symbol,
    buyVenue: e.buyVenue,
    sellVenue: e.sellVenue,
    detectedAtMs: e.detectedAtMs,
    reason: e.reason,
    estimatedMissedProfitQuote: e.estimatedMissedProfitQuote,
  }));
}

export function topRoutesByPaperPnL(
  trades: PaperArbitrageTrade[],
  limit = 10,
): RouteAggregate[] {
  const map = new Map<string, RouteAggregate>();
  for (const t of trades) {
    const key = `${t.buyVenue}|${t.sellVenue}`;
    const cur = map.get(key) ?? {
      buyVenue: t.buyVenue,
      sellVenue: t.sellVenue,
      trades: 0,
      totalQuote: 0,
    };
    cur.trades += 1;
    cur.totalQuote += t.netProfitQuote;
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => {
      if (a.totalQuote !== b.totalQuote) return b.totalQuote - a.totalQuote;
      const an = `${a.buyVenue}|${a.sellVenue}`;
      const bn = `${b.buyVenue}|${b.sellVenue}`;
      return an < bn ? -1 : an > bn ? 1 : 0;
    })
    .slice(0, limit);
}

export function topRoutesByMissedPnL(
  missed: MissedOpportunityReport,
  limit = 10,
): RouteAggregate[] {
  const map = new Map<string, RouteAggregate>();
  for (const e of missed.entries) {
    if (e.estimatedMissedProfitQuote <= 0) continue;
    const key = `${e.buyVenue}|${e.sellVenue}`;
    const cur = map.get(key) ?? {
      buyVenue: e.buyVenue,
      sellVenue: e.sellVenue,
      trades: 0,
      totalQuote: 0,
    };
    cur.trades += 1;
    cur.totalQuote += e.estimatedMissedProfitQuote;
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => {
      if (a.totalQuote !== b.totalQuote) return b.totalQuote - a.totalQuote;
      const an = `${a.buyVenue}|${a.sellVenue}`;
      const bn = `${b.buyVenue}|${b.sellVenue}`;
      return an < bn ? -1 : an > bn ? 1 : 0;
    })
    .slice(0, limit);
}

export function topSymbolsByInventoryEfficiency(
  trades: PaperArbitrageTrade[],
  limit = 10,
): SymbolInventoryEfficiency[] {
  const map = new Map<string, SymbolInventoryEfficiency>();
  for (const t of trades) {
    // Cheap guard: malformed symbol -> skip without crashing.
    try {
      parseSymbol(t.symbol);
    } catch {
      continue;
    }
    const cur = map.get(t.symbol) ?? {
      symbol: t.symbol,
      trades: 0,
      totalNetProfitQuote: 0,
      totalBaseQty: 0,
      profitPerBase: 0,
    };
    cur.trades += 1;
    cur.totalNetProfitQuote += t.netProfitQuote;
    cur.totalBaseQty += t.baseQty;
    map.set(t.symbol, cur);
  }
  for (const v of map.values()) {
    v.profitPerBase = v.totalBaseQty > 0 ? v.totalNetProfitQuote / v.totalBaseQty : 0;
  }
  return Array.from(map.values())
    .sort((a, b) => {
      if (a.profitPerBase !== b.profitPerBase) return b.profitPerBase - a.profitPerBase;
      return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
    })
    .slice(0, limit);
}
