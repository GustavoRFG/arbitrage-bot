import { getDb, hasPaperSimulatorSchema } from '../db';

export interface SimulationRunRow {
  simulationRunId: string;
  sourceScannerRunId: string;
  createdAtMs: number;
  policyName: string;
  selectionMode: string;
  latencyMs: number;
  minProfitQuote: number;
  minSpreadPct: number;
  maxNotionalQuote: number;
  reentryCooldownMs: number | null;
  symbolsFilterJson: string | null;
  routesFilterJson: string | null;
  initialPortfolioJson: string;
  finalPortfolioJson: string;
  eligibleLifecycles: number;
  totalTrades: number;
  totalRejected: number;
  rejectionsJson: string;
  totalNetProfitQuote: number;
  status: 'completed' | 'failed';
}

export interface PaperTradeRow {
  id: number;
  simulationRunId: string;
  lifecycleId: number;
  candidateId: number | null;
  estimateId: number | null;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  detectedAtMs: number;
  executedAtMs: number;
  latencyMs: number;
  targetNotionalQuote: number;
  executableBuyNotional: number;
  executableSellNotional: number;
  baseQty: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  feesQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  buyQuoteDelta: number;
  buyBaseDelta: number;
  sellBaseDelta: number;
  sellQuoteDelta: number;
  policyName: string;
}

export type RejectionReason =
  | 'no_eligible_estimate'
  | 'below_threshold'
  | 'latency_expired'
  | 'insufficient_quote_inventory'
  | 'insufficient_base_inventory'
  | 'lifecycle_too_short_for_latency';

export interface PortfolioBalances {
  [venue: string]: { [asset: string]: number };
}

/**
 * A "simulation family" groups simulation runs that share the same source
 * scanner run, policy, selection mode, thresholds, and creation timestamp
 * window. Each CLI invocation with multiple --latencies values produces one
 * such family; the dashboard's Paper Simulator page picks one family at a
 * time and renders the latency-by-latency comparison from it.
 */
export interface SimulationFamilyKey {
  sourceScannerRunId: string;
  policyName: string;
  selectionMode: string;
  minProfitQuote: number;
  minSpreadPct: number;
  maxNotionalQuote: number;
  createdAtMs: number;
}

export interface SimulationFamily extends SimulationFamilyKey {
  familyId: string;
  scenarios: SimulationRunRow[];
}

export function listSimulationRunsForScanner(scannerRunId: string): SimulationRunRow[] {
  const { db, exists } = getDb();
  if (!exists || !hasPaperSimulatorSchema(db)) return [];
  return db
    .prepare(
      `SELECT simulation_run_id AS simulationRunId,
              source_scanner_run_id AS sourceScannerRunId,
              created_at AS createdAtMs,
              policy_name AS policyName,
              selection_mode AS selectionMode,
              latency_ms AS latencyMs,
              min_profit_quote AS minProfitQuote,
              min_spread_pct AS minSpreadPct,
              max_notional_quote AS maxNotionalQuote,
              reentry_cooldown_ms AS reentryCooldownMs,
              symbols_filter_json AS symbolsFilterJson,
              routes_filter_json AS routesFilterJson,
              initial_portfolio_json AS initialPortfolioJson,
              final_portfolio_json AS finalPortfolioJson,
              eligible_lifecycles AS eligibleLifecycles,
              total_trades AS totalTrades,
              total_rejected AS totalRejected,
              rejections_json AS rejectionsJson,
              total_net_profit_quote AS totalNetProfitQuote,
              status
       FROM paper_simulation_runs
       WHERE source_scanner_run_id = ?
       ORDER BY created_at DESC, latency_ms ASC`,
    )
    .all(scannerRunId) as SimulationRunRow[];
}

export function getSimulationRun(simulationRunId: string): SimulationRunRow | null {
  const { db, exists } = getDb();
  if (!exists || !hasPaperSimulatorSchema(db)) return null;
  const row = db
    .prepare(
      `SELECT simulation_run_id AS simulationRunId,
              source_scanner_run_id AS sourceScannerRunId,
              created_at AS createdAtMs,
              policy_name AS policyName,
              selection_mode AS selectionMode,
              latency_ms AS latencyMs,
              min_profit_quote AS minProfitQuote,
              min_spread_pct AS minSpreadPct,
              max_notional_quote AS maxNotionalQuote,
              reentry_cooldown_ms AS reentryCooldownMs,
              symbols_filter_json AS symbolsFilterJson,
              routes_filter_json AS routesFilterJson,
              initial_portfolio_json AS initialPortfolioJson,
              final_portfolio_json AS finalPortfolioJson,
              eligible_lifecycles AS eligibleLifecycles,
              total_trades AS totalTrades,
              total_rejected AS totalRejected,
              rejections_json AS rejectionsJson,
              total_net_profit_quote AS totalNetProfitQuote,
              status
       FROM paper_simulation_runs
       WHERE simulation_run_id = ?`,
    )
    .get(simulationRunId) as SimulationRunRow | undefined;
  return row ?? null;
}

export function listPaperTrades(simulationRunId: string, limit = 500): PaperTradeRow[] {
  const { db, exists } = getDb();
  if (!exists || !hasPaperSimulatorSchema(db)) return [];
  return db
    .prepare(
      `SELECT id,
              simulation_run_id AS simulationRunId,
              lifecycle_id AS lifecycleId,
              candidate_id AS candidateId,
              estimate_id AS estimateId,
              symbol,
              buy_venue AS buyVenue,
              sell_venue AS sellVenue,
              detected_at AS detectedAtMs,
              executed_at AS executedAtMs,
              latency_ms AS latencyMs,
              target_notional_quote AS targetNotionalQuote,
              executable_buy_notional AS executableBuyNotional,
              executable_sell_notional AS executableSellNotional,
              base_qty AS baseQty,
              avg_buy_price AS avgBuyPrice,
              avg_sell_price AS avgSellPrice,
              fees_quote AS feesQuote,
              net_profit_quote AS netProfitQuote,
              net_spread_pct AS netSpreadPct,
              buy_quote_delta AS buyQuoteDelta,
              buy_base_delta AS buyBaseDelta,
              sell_base_delta AS sellBaseDelta,
              sell_quote_delta AS sellQuoteDelta,
              policy_name AS policyName
       FROM paper_arbitrage_trades
       WHERE simulation_run_id = ?
       ORDER BY executed_at ASC, id ASC
       LIMIT ?`,
    )
    .all(simulationRunId, limit) as PaperTradeRow[];
}

/**
 * Group scanner simulations into "families" — each family is one CLI
 * invocation that swept multiple latency scenarios with the same policy.
 * Two scenarios belong to the same family if they share scanner run, policy,
 * selection mode, all thresholds, and their `created_at` timestamps fall
 * inside a small cluster window (defaults to 5s).
 */
export function listSimulationFamilies(
  scannerRunId: string,
  clusterWindowMs = 5_000,
): SimulationFamily[] {
  const rows = listSimulationRunsForScanner(scannerRunId);
  const families: SimulationFamily[] = [];
  const sorted = rows.slice().sort((a, b) => b.createdAtMs - a.createdAtMs);

  for (const row of sorted) {
    const match = families.find(
      (f) =>
        f.sourceScannerRunId === row.sourceScannerRunId &&
        f.policyName === row.policyName &&
        f.selectionMode === row.selectionMode &&
        f.minProfitQuote === row.minProfitQuote &&
        f.minSpreadPct === row.minSpreadPct &&
        f.maxNotionalQuote === row.maxNotionalQuote &&
        Math.abs(row.createdAtMs - f.createdAtMs) <= clusterWindowMs,
    );
    if (match) {
      match.scenarios.push(row);
      // Keep the most recent createdAt for the family
      if (row.createdAtMs > match.createdAtMs) match.createdAtMs = row.createdAtMs;
    } else {
      families.push({
        familyId: `${row.sourceScannerRunId}:${row.createdAtMs}:${row.policyName}`,
        sourceScannerRunId: row.sourceScannerRunId,
        policyName: row.policyName,
        selectionMode: row.selectionMode,
        minProfitQuote: row.minProfitQuote,
        minSpreadPct: row.minSpreadPct,
        maxNotionalQuote: row.maxNotionalQuote,
        createdAtMs: row.createdAtMs,
        scenarios: [row],
      });
    }
  }

  // Sort scenarios within each family by latency ascending
  for (const fam of families) {
    fam.scenarios.sort((a, b) => a.latencyMs - b.latencyMs);
  }
  return families;
}

export function parseRejections(json: string | null): Record<RejectionReason, number> {
  const empty: Record<RejectionReason, number> = {
    no_eligible_estimate: 0,
    below_threshold: 0,
    latency_expired: 0,
    insufficient_quote_inventory: 0,
    insufficient_base_inventory: 0,
    lifecycle_too_short_for_latency: 0,
  };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json) as Partial<Record<RejectionReason, number>>;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}

export function parsePortfolio(json: string | null): PortfolioBalances {
  if (!json) return {};
  try {
    return JSON.parse(json) as PortfolioBalances;
  } catch {
    return {};
  }
}

export function portfolioDrift(
  before: PortfolioBalances,
  after: PortfolioBalances,
): PortfolioBalances {
  const venues = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: PortfolioBalances = {};
  for (const venue of venues) {
    const b = before[venue] ?? {};
    const a = after[venue] ?? {};
    const assets = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
    const inner: { [asset: string]: number } = {};
    for (const asset of assets) {
      inner[asset] = (a[asset] ?? 0) - (b[asset] ?? 0);
    }
    out[venue] = inner;
  }
  return out;
}

/** Aggregate trade rows by route within a single simulation_run. */
export interface RoutePnLRow {
  buyVenue: string;
  sellVenue: string;
  trades: number;
  totalNetProfitQuote: number;
  avgNetProfitQuote: number;
}

export interface SymbolPnLRow {
  symbol: string;
  trades: number;
  totalNetProfitQuote: number;
  avgNetProfitQuote: number;
}

export function aggregateRoutePnL(trades: PaperTradeRow[]): RoutePnLRow[] {
  const map = new Map<string, RoutePnLRow>();
  for (const t of trades) {
    const key = `${t.buyVenue}|${t.sellVenue}`;
    const cur = map.get(key) ?? {
      buyVenue: t.buyVenue,
      sellVenue: t.sellVenue,
      trades: 0,
      totalNetProfitQuote: 0,
      avgNetProfitQuote: 0,
    };
    cur.trades += 1;
    cur.totalNetProfitQuote += t.netProfitQuote;
    map.set(key, cur);
  }
  const out = Array.from(map.values());
  for (const r of out) r.avgNetProfitQuote = r.trades > 0 ? r.totalNetProfitQuote / r.trades : 0;
  out.sort((a, b) => b.totalNetProfitQuote - a.totalNetProfitQuote);
  return out;
}

export function aggregateSymbolPnL(trades: PaperTradeRow[]): SymbolPnLRow[] {
  const map = new Map<string, SymbolPnLRow>();
  for (const t of trades) {
    const cur = map.get(t.symbol) ?? {
      symbol: t.symbol,
      trades: 0,
      totalNetProfitQuote: 0,
      avgNetProfitQuote: 0,
    };
    cur.trades += 1;
    cur.totalNetProfitQuote += t.netProfitQuote;
    map.set(t.symbol, cur);
  }
  const out = Array.from(map.values());
  for (const r of out) r.avgNetProfitQuote = r.trades > 0 ? r.totalNetProfitQuote / r.trades : 0;
  out.sort((a, b) => b.totalNetProfitQuote - a.totalNetProfitQuote);
  return out;
}

/**
 * Pick the "best simulation" for a scanner run — the latest simulation
 * scenario with the highest total_net_profit_quote across all families.
 * Used by the Overview page to surface a single headline number.
 */
export function getBestSimulationForScanner(scannerRunId: string): SimulationRunRow | null {
  const rows = listSimulationRunsForScanner(scannerRunId);
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => b.totalNetProfitQuote - a.totalNetProfitQuote)[0] ?? null;
}
