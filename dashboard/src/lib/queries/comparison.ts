/**
 * Phase 2.6 — dashboard queries for the paper-comparison persistence layer.
 *
 * All functions are strictly read-only. They return `null` / `[]` when the
 * comparison schema has not been created yet (i.e. the user hasn't run
 * `paper-cex-compare` against a fresh DB) so callers can render an empty
 * state with the CLI command instead of crashing.
 */

import { getDb } from '../db';
import type { Database as BetterDb } from 'better-sqlite3';

import type { PortfolioBalances, RejectionReason } from './simulator';

/** True when migration 005 has been applied. */
export function hasPaperComparisonSchema(db: BetterDb): boolean {
  try {
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='paper_comparison_runs'`,
      )
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

export interface ComparisonRunRow {
  comparisonRunId: string;
  sourceScannerRunId: string;
  createdAtMs: number;
  label: string | null;
  policyName: string;
  selectionMode: string;
  minProfitQuote: number;
  minSpreadPct: number;
  maxNotionalQuote: number;
  reentryCooldownMs: number | null;
  contentionMode: 'single_route' | 'multi_route';
  latenciesJson: string;
  presetsJson: string;
  symbolsFilterJson: string | null;
  routesFilterJson: string | null;
  eligibleLifecycles: number;
  cellCount: number;
  bestTotalNetProfitQuote: number | null;
  bestPreset: string | null;
  bestLatencyMs: number | null;
  totalMissedProfitQuote: number | null;
  topBottleneckReason: RejectionReason | null;
}

export interface ComparisonScenarioRow {
  scenarioId: number;
  comparisonRunId: string;
  simulationRunId: string;
  presetName: string;
  presetLabel: string;
  latencyMs: number;
  contentionMode: 'single_route' | 'multi_route';
  executedTrades: number;
  totalNetProfitQuote: number;
  totalMissedProfitQuote: number;
  rejectionsByReasonJson: string;
  missedProfitByReasonJson: string;
  topBottleneckReason: RejectionReason | null;
  initialPortfolioJson: string;
  finalPortfolioJson: string;
  finalInventoryDriftJson: string;
  topExecutedJson: string;
  topMissedJson: string;
  topRoutesPaperPnlJson: string;
  topRoutesMissedPnlJson: string;
  topSymbolsEfficiencyJson: string;
}

export interface ComparisonMatrixCell {
  presetName: string;
  presetLabel: string;
  latencyMs: number;
  executedTrades: number;
  totalNetProfitQuote: number;
  totalMissedProfitQuote: number;
  topBottleneckReason: RejectionReason | null;
}

export interface ComparisonMatrix {
  presets: Array<{ name: string; label: string }>;
  latencies: number[];
  cells: ComparisonMatrixCell[];
}

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
  reason: RejectionReason;
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
  totalBaseQty: number;
  profitPerBase: number;
}

// --- run / scenario lookups --------------------------------------------------

export function listComparisonRuns(scannerRunId: string): ComparisonRunRow[] {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return [];
  return db
    .prepare(
      `SELECT comparison_run_id          AS comparisonRunId,
              source_scanner_run_id      AS sourceScannerRunId,
              created_at                 AS createdAtMs,
              label,
              policy_name                AS policyName,
              selection_mode             AS selectionMode,
              min_profit_quote           AS minProfitQuote,
              min_spread_pct             AS minSpreadPct,
              max_notional_quote         AS maxNotionalQuote,
              reentry_cooldown_ms        AS reentryCooldownMs,
              contention_mode            AS contentionMode,
              latencies_json             AS latenciesJson,
              presets_json               AS presetsJson,
              symbols_filter_json        AS symbolsFilterJson,
              routes_filter_json         AS routesFilterJson,
              eligible_lifecycles        AS eligibleLifecycles,
              cell_count                 AS cellCount,
              best_total_net_profit_quote AS bestTotalNetProfitQuote,
              best_preset                AS bestPreset,
              best_latency_ms            AS bestLatencyMs,
              total_missed_profit_quote  AS totalMissedProfitQuote,
              top_bottleneck_reason      AS topBottleneckReason
       FROM paper_comparison_runs
       WHERE source_scanner_run_id = ?
       ORDER BY created_at DESC`,
    )
    .all(scannerRunId) as ComparisonRunRow[];
}

export function getComparisonRun(comparisonRunId: string): ComparisonRunRow | null {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return null;
  const row = db
    .prepare(
      `SELECT comparison_run_id          AS comparisonRunId,
              source_scanner_run_id      AS sourceScannerRunId,
              created_at                 AS createdAtMs,
              label,
              policy_name                AS policyName,
              selection_mode             AS selectionMode,
              min_profit_quote           AS minProfitQuote,
              min_spread_pct             AS minSpreadPct,
              max_notional_quote         AS maxNotionalQuote,
              reentry_cooldown_ms        AS reentryCooldownMs,
              contention_mode            AS contentionMode,
              latencies_json             AS latenciesJson,
              presets_json               AS presetsJson,
              symbols_filter_json        AS symbolsFilterJson,
              routes_filter_json         AS routesFilterJson,
              eligible_lifecycles        AS eligibleLifecycles,
              cell_count                 AS cellCount,
              best_total_net_profit_quote AS bestTotalNetProfitQuote,
              best_preset                AS bestPreset,
              best_latency_ms            AS bestLatencyMs,
              total_missed_profit_quote  AS totalMissedProfitQuote,
              top_bottleneck_reason      AS topBottleneckReason
       FROM paper_comparison_runs
       WHERE comparison_run_id = ?`,
    )
    .get(comparisonRunId) as ComparisonRunRow | undefined;
  return row ?? null;
}

export function getLatestComparisonRun(scannerRunId: string): ComparisonRunRow | null {
  return listComparisonRuns(scannerRunId)[0] ?? null;
}

export function getComparisonScenarios(comparisonRunId: string): ComparisonScenarioRow[] {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return [];
  return db
    .prepare(
      `SELECT scenario_id                AS scenarioId,
              comparison_run_id          AS comparisonRunId,
              simulation_run_id          AS simulationRunId,
              preset_name                AS presetName,
              preset_label               AS presetLabel,
              latency_ms                 AS latencyMs,
              contention_mode            AS contentionMode,
              executed_trades            AS executedTrades,
              total_net_profit_quote     AS totalNetProfitQuote,
              total_missed_profit_quote  AS totalMissedProfitQuote,
              rejections_by_reason_json  AS rejectionsByReasonJson,
              missed_profit_by_reason_json AS missedProfitByReasonJson,
              top_bottleneck_reason      AS topBottleneckReason,
              initial_portfolio_json     AS initialPortfolioJson,
              final_portfolio_json       AS finalPortfolioJson,
              final_inventory_drift_json AS finalInventoryDriftJson,
              top_executed_json          AS topExecutedJson,
              top_missed_json            AS topMissedJson,
              top_routes_paper_pnl_json  AS topRoutesPaperPnlJson,
              top_routes_missed_pnl_json AS topRoutesMissedPnlJson,
              top_symbols_efficiency_json AS topSymbolsEfficiencyJson
       FROM paper_comparison_scenarios
       WHERE comparison_run_id = ?
       ORDER BY preset_name ASC, latency_ms ASC`,
    )
    .all(comparisonRunId) as ComparisonScenarioRow[];
}

export function getScenarioById(scenarioId: number): ComparisonScenarioRow | null {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return null;
  const row = db
    .prepare(
      `SELECT scenario_id                AS scenarioId,
              comparison_run_id          AS comparisonRunId,
              simulation_run_id          AS simulationRunId,
              preset_name                AS presetName,
              preset_label               AS presetLabel,
              latency_ms                 AS latencyMs,
              contention_mode            AS contentionMode,
              executed_trades            AS executedTrades,
              total_net_profit_quote     AS totalNetProfitQuote,
              total_missed_profit_quote  AS totalMissedProfitQuote,
              rejections_by_reason_json  AS rejectionsByReasonJson,
              missed_profit_by_reason_json AS missedProfitByReasonJson,
              top_bottleneck_reason      AS topBottleneckReason,
              initial_portfolio_json     AS initialPortfolioJson,
              final_portfolio_json       AS finalPortfolioJson,
              final_inventory_drift_json AS finalInventoryDriftJson,
              top_executed_json          AS topExecutedJson,
              top_missed_json            AS topMissedJson,
              top_routes_paper_pnl_json  AS topRoutesPaperPnlJson,
              top_routes_missed_pnl_json AS topRoutesMissedPnlJson,
              top_symbols_efficiency_json AS topSymbolsEfficiencyJson
       FROM paper_comparison_scenarios
       WHERE scenario_id = ?`,
    )
    .get(scenarioId) as ComparisonScenarioRow | undefined;
  return row ?? null;
}

// --- shaped helpers ----------------------------------------------------------

export function getComparisonMatrix(comparisonRunId: string): ComparisonMatrix {
  const scenarios = getComparisonScenarios(comparisonRunId);
  const presetOrder = new Map<string, { name: string; label: string }>();
  const latencySet = new Set<number>();
  for (const s of scenarios) {
    if (!presetOrder.has(s.presetName)) {
      presetOrder.set(s.presetName, { name: s.presetName, label: s.presetLabel });
    }
    latencySet.add(s.latencyMs);
  }
  const latencies = Array.from(latencySet).sort((a, b) => a - b);
  return {
    presets: Array.from(presetOrder.values()),
    latencies,
    cells: scenarios.map((s) => ({
      presetName: s.presetName,
      presetLabel: s.presetLabel,
      latencyMs: s.latencyMs,
      executedTrades: s.executedTrades,
      totalNetProfitQuote: s.totalNetProfitQuote,
      totalMissedProfitQuote: s.totalMissedProfitQuote,
      topBottleneckReason: s.topBottleneckReason,
    })),
  };
}

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function getMissedPnlByReason(
  comparisonRunId: string,
  scenarioId?: number,
): Array<{
  presetName: string;
  latencyMs: number;
  byReason: Record<RejectionReason, number>;
}> {
  const scenarios =
    scenarioId === undefined
      ? getComparisonScenarios(comparisonRunId)
      : [getScenarioById(scenarioId)].filter(Boolean) as ComparisonScenarioRow[];
  return scenarios.map((s) => ({
    presetName: s.presetName,
    latencyMs: s.latencyMs,
    byReason: parseJson<Record<RejectionReason, number>>(
      s.missedProfitByReasonJson,
      {
        no_eligible_estimate: 0,
        below_threshold: 0,
        latency_expired: 0,
        insufficient_quote_inventory: 0,
        insufficient_base_inventory: 0,
        lifecycle_too_short_for_latency: 0,
      },
    ),
  }));
}

export function getTopExecutedTrades(
  comparisonRunId: string,
  scenarioId?: number,
): TopExecutedTrade[] {
  const scenarios =
    scenarioId === undefined
      ? getComparisonScenarios(comparisonRunId)
      : [getScenarioById(scenarioId)].filter(Boolean) as ComparisonScenarioRow[];
  if (scenarios.length === 0) return [];
  if (scenarioId !== undefined) {
    return parseJson<TopExecutedTrade[]>(scenarios[0]!.topExecutedJson, []);
  }
  const combined: TopExecutedTrade[] = [];
  for (const s of scenarios) {
    combined.push(...parseJson<TopExecutedTrade[]>(s.topExecutedJson, []));
  }
  combined.sort((a, b) => b.netProfitQuote - a.netProfitQuote);
  return combined.slice(0, 10);
}

export function getTopMissedTrades(
  comparisonRunId: string,
  scenarioId?: number,
): TopMissedTrade[] {
  const scenarios =
    scenarioId === undefined
      ? getComparisonScenarios(comparisonRunId)
      : [getScenarioById(scenarioId)].filter(Boolean) as ComparisonScenarioRow[];
  if (scenarios.length === 0) return [];
  if (scenarioId !== undefined) {
    return parseJson<TopMissedTrade[]>(scenarios[0]!.topMissedJson, []);
  }
  const combined: TopMissedTrade[] = [];
  for (const s of scenarios) {
    combined.push(...parseJson<TopMissedTrade[]>(s.topMissedJson, []));
  }
  combined.sort((a, b) => b.estimatedMissedProfitQuote - a.estimatedMissedProfitQuote);
  return combined.slice(0, 10);
}

export function getRoutePnlComparison(
  comparisonRunId: string,
  scenarioId?: number,
): RouteAggregate[] {
  if (scenarioId === undefined) {
    const scenarios = getComparisonScenarios(comparisonRunId);
    if (scenarios.length === 0) return [];
    const map = new Map<string, RouteAggregate>();
    for (const s of scenarios) {
      for (const r of parseJson<RouteAggregate[]>(s.topRoutesPaperPnlJson, [])) {
        const key = `${r.buyVenue}|${r.sellVenue}`;
        const cur = map.get(key) ?? { ...r, trades: 0, totalQuote: 0 };
        cur.trades += r.trades;
        cur.totalQuote += r.totalQuote;
        map.set(key, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.totalQuote - a.totalQuote)
      .slice(0, 15);
  }
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return [];
  return parseJson<RouteAggregate[]>(scenario.topRoutesPaperPnlJson, []);
}

export function getRouteMissedPnlComparison(
  comparisonRunId: string,
  scenarioId?: number,
): RouteAggregate[] {
  if (scenarioId === undefined) {
    const scenarios = getComparisonScenarios(comparisonRunId);
    if (scenarios.length === 0) return [];
    const map = new Map<string, RouteAggregate>();
    for (const s of scenarios) {
      for (const r of parseJson<RouteAggregate[]>(s.topRoutesMissedPnlJson, [])) {
        const key = `${r.buyVenue}|${r.sellVenue}`;
        const cur = map.get(key) ?? { ...r, trades: 0, totalQuote: 0 };
        cur.trades += r.trades;
        cur.totalQuote += r.totalQuote;
        map.set(key, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.totalQuote - a.totalQuote)
      .slice(0, 15);
  }
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return [];
  return parseJson<RouteAggregate[]>(scenario.topRoutesMissedPnlJson, []);
}

export function getSymbolInventoryEfficiency(
  comparisonRunId: string,
  scenarioId?: number,
): SymbolInventoryEfficiency[] {
  if (scenarioId === undefined) {
    const scenarios = getComparisonScenarios(comparisonRunId);
    if (scenarios.length === 0) return [];
    // Aggregate across scenarios by recomputing profitPerBase from totals.
    const map = new Map<string, SymbolInventoryEfficiency>();
    for (const s of scenarios) {
      for (const sym of parseJson<SymbolInventoryEfficiency[]>(
        s.topSymbolsEfficiencyJson,
        [],
      )) {
        const cur = map.get(sym.symbol) ?? {
          symbol: sym.symbol,
          trades: 0,
          totalNetProfitQuote: 0,
          totalBaseQty: 0,
          profitPerBase: 0,
        };
        cur.trades += sym.trades;
        cur.totalNetProfitQuote += sym.totalNetProfitQuote;
        cur.totalBaseQty += sym.totalBaseQty;
        map.set(sym.symbol, cur);
      }
    }
    for (const v of map.values()) {
      v.profitPerBase = v.totalBaseQty > 0 ? v.totalNetProfitQuote / v.totalBaseQty : 0;
    }
    return Array.from(map.values())
      .sort((a, b) => b.profitPerBase - a.profitPerBase)
      .slice(0, 15);
  }
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return [];
  return parseJson<SymbolInventoryEfficiency[]>(scenario.topSymbolsEfficiencyJson, []);
}

export function getInventoryDriftForScenario(scenarioId: number): {
  initial: PortfolioBalances;
  final: PortfolioBalances;
  drift: PortfolioBalances;
} | null {
  const s = getScenarioById(scenarioId);
  if (!s) return null;
  return {
    initial: parseJson<PortfolioBalances>(s.initialPortfolioJson, {}),
    final: parseJson<PortfolioBalances>(s.finalPortfolioJson, {}),
    drift: parseJson<PortfolioBalances>(s.finalInventoryDriftJson, {}),
  };
}

/**
 * Has ANY comparison been persisted for this scanner run?
 *
 * Used by the Overview page to decide between "show capturable card" and
 * "show empty state with CLI command".
 */
export function scannerRunHasComparison(scannerRunId: string): boolean {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return false;
  const row = db
    .prepare(
      `SELECT 1 AS one FROM paper_comparison_runs
       WHERE source_scanner_run_id = ? LIMIT 1`,
    )
    .get(scannerRunId) as { one: number } | undefined;
  return Boolean(row);
}
