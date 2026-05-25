import { getDb } from '../db';

export interface ScannerRunRow {
  runId: string;
  mode: string;
  status: 'running' | 'completed' | 'aborted' | 'failed' | 'interrupted';
  startedAtMs: number;
  endedAtMs: number | null;
  actualElapsedMs: number | null;
  totalCycles: number;
  totalSymbolsScanned: number;
  totalCandidates: number;
  totalMaterialCandidates: number;
  universeJson: string | null;
}

export interface UniverseMetadata {
  symbolMode: string;
  enabledExchanges: string[];
  resolvedSymbols: string[];
  minVenuesPerSymbol: number;
  maxSymbols: number;
  truncated: boolean;
  materialRule: {
    minNetProfitQuote: number;
    minExecutableNetSpreadPct: number;
    description: string;
  };
}

export interface RunFunnel {
  rawCandidates: number;
  candidatesNetPositive: number;
  estimatesCalculated: number;
  estimatesDepthSupportedAt100: number;
  estimatesDepthSupportedAt500: number;
  estimatesTradablePrefunded: number;
  lifecycles: number;
  singleObservationLifecycles: number;
  multiObservationLifecycles: number;
}

export interface RunHeadlineStats {
  maxNetProfitQuote: number;
  medianNetProfitQuote: number;
  bestSymbol: { symbol: string; count: number } | null;
  bestRoute: { buyExchange: string; sellExchange: string; count: number } | null;
  longestLifecycleMs: number;
  medianLifecycleMs: number;
  totalSnapshots: number;
}

export interface SymbolBreakdown {
  symbol: string;
  rawCandidates: number;
  depthEstimates: number;
  tradableEstimates: number;
  lifecycles: number;
  maxLifecycleMs: number;
  maxNetProfitQuote: number;
}

export interface RouteBreakdown {
  buyExchange: string;
  sellExchange: string;
  rawCandidates: number;
  depthEstimates: number;
  tradableEstimates: number;
  lifecycles: number;
  maxLifecycleMs: number;
  maxNetProfitQuote: number;
}

export interface LifecycleAuditRow {
  id: number;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  effectiveDurationMs: number;
  observationCount: number;
  status: 'open' | 'closed';
  maxApproxNetSpreadPct: number;
  maxNetProfitQuote: number;
  maxSupportedNotionalQuote: number;
  eventKey: string;
}

export interface TimeBucket {
  bucketStartMs: number;
  candidates: number;
}

function parseUniverse(json: string | null): UniverseMetadata | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as UniverseMetadata;
  } catch {
    return null;
  }
}

export function listScannerRuns(limit = 50): Array<
  ScannerRunRow & { universe: UniverseMetadata | null }
> {
  const { db, exists } = getDb();
  if (!exists) return [];
  const rows = db
    .prepare(
      `SELECT run_id              AS runId,
              mode,
              status,
              started_at           AS startedAtMs,
              ended_at             AS endedAtMs,
              actual_elapsed_ms    AS actualElapsedMs,
              total_cycles         AS totalCycles,
              total_symbols_scanned AS totalSymbolsScanned,
              total_candidates     AS totalCandidates,
              total_material_candidates AS totalMaterialCandidates,
              universe_json        AS universeJson
       FROM scanner_runs
       WHERE mode = 'cex' OR mode = 'all'
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as ScannerRunRow[];
  return rows.map((row) => ({ ...row, universe: parseUniverse(row.universeJson) }));
}

export function getScannerRun(runId: string): (ScannerRunRow & { universe: UniverseMetadata | null }) | null {
  const { db, exists } = getDb();
  if (!exists) return null;
  const row = db
    .prepare(
      `SELECT run_id              AS runId,
              mode,
              status,
              started_at           AS startedAtMs,
              ended_at             AS endedAtMs,
              actual_elapsed_ms    AS actualElapsedMs,
              total_cycles         AS totalCycles,
              total_symbols_scanned AS totalSymbolsScanned,
              total_candidates     AS totalCandidates,
              total_material_candidates AS totalMaterialCandidates,
              universe_json        AS universeJson
       FROM scanner_runs
       WHERE run_id = ?`,
    )
    .get(runId) as ScannerRunRow | undefined;
  if (!row) return null;
  return { ...row, universe: parseUniverse(row.universeJson) };
}

export function getMostRecentScannerRunId(): string | null {
  const { db, exists } = getDb();
  if (!exists) return null;
  const row = db
    .prepare(
      `SELECT run_id AS runId
       FROM scanner_runs
       WHERE mode IN ('cex', 'all')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as { runId: string } | undefined;
  return row?.runId ?? null;
}

export function getRunFunnel(runId: string): RunFunnel {
  const { db, exists } = getDb();
  const empty: RunFunnel = {
    rawCandidates: 0,
    candidatesNetPositive: 0,
    estimatesCalculated: 0,
    estimatesDepthSupportedAt100: 0,
    estimatesDepthSupportedAt500: 0,
    estimatesTradablePrefunded: 0,
    lifecycles: 0,
    singleObservationLifecycles: 0,
    multiObservationLifecycles: 0,
  };
  if (!exists) return empty;

  const candidates = db
    .prepare(`SELECT COUNT(*) AS n FROM cex_arbitrage_candidates WHERE run_id = ?`)
    .get(runId) as { n: number };
  const candNet = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_arbitrage_candidates
       WHERE run_id = ? AND approximate_net_spread_pct > 0`,
    )
    .get(runId) as { n: number };
  const estimates = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ?`,
    )
    .get(runId) as { n: number };
  const depthSupportedAt100 = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ? AND e.target_notional_quote = 100 AND e.supported_by_depth = 1`,
    )
    .get(runId) as { n: number };
  const depthSupportedAt500 = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ? AND e.target_notional_quote = 500 AND e.supported_by_depth = 1`,
    )
    .get(runId) as { n: number };
  const tradable = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ? AND e.tradable_prefunded = 1`,
    )
    .get(runId) as { n: number };
  const lifecycles = db
    .prepare(`SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles WHERE run_id = ?`)
    .get(runId) as { n: number };
  const single = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles WHERE run_id = ? AND observation_count = 1`,
    )
    .get(runId) as { n: number };
  const multi = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles WHERE run_id = ? AND observation_count > 1`,
    )
    .get(runId) as { n: number };

  return {
    rawCandidates: candidates.n,
    candidatesNetPositive: candNet.n,
    estimatesCalculated: estimates.n,
    estimatesDepthSupportedAt100: depthSupportedAt100.n,
    estimatesDepthSupportedAt500: depthSupportedAt500.n,
    estimatesTradablePrefunded: tradable.n,
    lifecycles: lifecycles.n,
    singleObservationLifecycles: single.n,
    multiObservationLifecycles: multi.n,
  };
}

export function getRunHeadlineStats(runId: string): RunHeadlineStats {
  const { db, exists } = getDb();
  const empty: RunHeadlineStats = {
    maxNetProfitQuote: 0,
    medianNetProfitQuote: 0,
    bestSymbol: null,
    bestRoute: null,
    longestLifecycleMs: 0,
    medianLifecycleMs: 0,
    totalSnapshots: 0,
  };
  if (!exists) return empty;

  const maxNet = db
    .prepare(
      `SELECT COALESCE(MAX(e.net_profit_quote), 0) AS m
       FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ?`,
    )
    .get(runId) as { m: number };

  const profits = db
    .prepare(
      `SELECT e.net_profit_quote AS v
       FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ?`,
    )
    .all(runId) as { v: number }[];

  const topSymbolRow = db
    .prepare(
      `SELECT symbol, COUNT(*) AS n
       FROM cex_arbitrage_candidates
       WHERE run_id = ?
       GROUP BY symbol ORDER BY n DESC LIMIT 1`,
    )
    .get(runId) as { symbol: string; n: number } | undefined;

  const topRouteRow = db
    .prepare(
      `SELECT buy_exchange AS buyExchange, sell_exchange AS sellExchange, COUNT(*) AS n
       FROM cex_arbitrage_candidates
       WHERE run_id = ?
       GROUP BY buy_exchange, sell_exchange ORDER BY n DESC LIMIT 1`,
    )
    .get(runId) as { buyExchange: string; sellExchange: string; n: number } | undefined;

  const longest = db
    .prepare(
      `SELECT COALESCE(MAX(COALESCE(duration_ms, last_seen_at - first_seen_at)), 0) AS m
       FROM cex_arbitrage_lifecycles
       WHERE run_id = ?`,
    )
    .get(runId) as { m: number };

  const lifecycleDurs = db
    .prepare(
      `SELECT COALESCE(duration_ms, last_seen_at - first_seen_at) AS v
       FROM cex_arbitrage_lifecycles
       WHERE run_id = ?`,
    )
    .all(runId) as { v: number }[];

  const snapshots = db
    .prepare(`SELECT COUNT(*) AS n FROM cex_order_book_snapshots WHERE run_id = ?`)
    .get(runId) as { n: number };

  return {
    maxNetProfitQuote: maxNet.m,
    medianNetProfitQuote: median(profits.map((r) => r.v)),
    bestSymbol: topSymbolRow ? { symbol: topSymbolRow.symbol, count: topSymbolRow.n } : null,
    bestRoute: topRouteRow
      ? {
          buyExchange: topRouteRow.buyExchange,
          sellExchange: topRouteRow.sellExchange,
          count: topRouteRow.n,
        }
      : null,
    longestLifecycleMs: longest.m,
    medianLifecycleMs: median(lifecycleDurs.map((r) => r.v)),
    totalSnapshots: snapshots.n,
  };
}

export function getSymbolBreakdown(runId: string): SymbolBreakdown[] {
  const { db, exists } = getDb();
  if (!exists) return [];

  const candRows = db
    .prepare(
      `SELECT symbol, COUNT(*) AS n
       FROM cex_arbitrage_candidates
       WHERE run_id = ?
       GROUP BY symbol`,
    )
    .all(runId) as { symbol: string; n: number }[];

  const estRows = db
    .prepare(
      `SELECT c.symbol AS symbol,
              COUNT(*) AS depth_estimates,
              SUM(CASE WHEN e.tradable_prefunded = 1 THEN 1 ELSE 0 END) AS tradable_estimates,
              MAX(e.net_profit_quote) AS max_net_profit
       FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ?
       GROUP BY c.symbol`,
    )
    .all(runId) as {
    symbol: string;
    depth_estimates: number;
    tradable_estimates: number | null;
    max_net_profit: number | null;
  }[];

  const lcRows = db
    .prepare(
      `SELECT symbol,
              COUNT(*) AS n,
              MAX(COALESCE(duration_ms, last_seen_at - first_seen_at)) AS max_dur
       FROM cex_arbitrage_lifecycles
       WHERE run_id = ?
       GROUP BY symbol`,
    )
    .all(runId) as { symbol: string; n: number; max_dur: number | null }[];

  const out = new Map<string, SymbolBreakdown>();
  const get = (symbol: string): SymbolBreakdown => {
    let row = out.get(symbol);
    if (!row) {
      row = {
        symbol,
        rawCandidates: 0,
        depthEstimates: 0,
        tradableEstimates: 0,
        lifecycles: 0,
        maxLifecycleMs: 0,
        maxNetProfitQuote: 0,
      };
      out.set(symbol, row);
    }
    return row;
  };
  for (const r of candRows) get(r.symbol).rawCandidates = r.n;
  for (const r of estRows) {
    const row = get(r.symbol);
    row.depthEstimates = r.depth_estimates;
    row.tradableEstimates = r.tradable_estimates ?? 0;
    row.maxNetProfitQuote = r.max_net_profit ?? 0;
  }
  for (const r of lcRows) {
    const row = get(r.symbol);
    row.lifecycles = r.n;
    row.maxLifecycleMs = r.max_dur ?? 0;
  }
  return Array.from(out.values()).sort((a, b) => b.rawCandidates - a.rawCandidates);
}

export function getRouteBreakdown(runId: string): RouteBreakdown[] {
  const { db, exists } = getDb();
  if (!exists) return [];

  const candRows = db
    .prepare(
      `SELECT buy_exchange AS buyExchange, sell_exchange AS sellExchange, COUNT(*) AS n
       FROM cex_arbitrage_candidates
       WHERE run_id = ?
       GROUP BY buy_exchange, sell_exchange`,
    )
    .all(runId) as { buyExchange: string; sellExchange: string; n: number }[];

  const estRows = db
    .prepare(
      `SELECT c.buy_exchange AS buyExchange,
              c.sell_exchange AS sellExchange,
              COUNT(*) AS depth_estimates,
              SUM(CASE WHEN e.tradable_prefunded = 1 THEN 1 ELSE 0 END) AS tradable_estimates,
              MAX(e.net_profit_quote) AS max_net_profit
       FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       WHERE c.run_id = ?
       GROUP BY c.buy_exchange, c.sell_exchange`,
    )
    .all(runId) as {
    buyExchange: string;
    sellExchange: string;
    depth_estimates: number;
    tradable_estimates: number | null;
    max_net_profit: number | null;
  }[];

  const lcRows = db
    .prepare(
      `SELECT buy_exchange AS buyExchange,
              sell_exchange AS sellExchange,
              COUNT(*) AS n,
              MAX(COALESCE(duration_ms, last_seen_at - first_seen_at)) AS max_dur
       FROM cex_arbitrage_lifecycles
       WHERE run_id = ?
       GROUP BY buy_exchange, sell_exchange`,
    )
    .all(runId) as { buyExchange: string; sellExchange: string; n: number; max_dur: number | null }[];

  const key = (b: string, s: string) => `${b}|${s}`;
  const out = new Map<string, RouteBreakdown>();
  const get = (buy: string, sell: string) => {
    const k = key(buy, sell);
    let row = out.get(k);
    if (!row) {
      row = {
        buyExchange: buy,
        sellExchange: sell,
        rawCandidates: 0,
        depthEstimates: 0,
        tradableEstimates: 0,
        lifecycles: 0,
        maxLifecycleMs: 0,
        maxNetProfitQuote: 0,
      };
      out.set(k, row);
    }
    return row;
  };
  for (const r of candRows) get(r.buyExchange, r.sellExchange).rawCandidates = r.n;
  for (const r of estRows) {
    const row = get(r.buyExchange, r.sellExchange);
    row.depthEstimates = r.depth_estimates;
    row.tradableEstimates = r.tradable_estimates ?? 0;
    row.maxNetProfitQuote = r.max_net_profit ?? 0;
  }
  for (const r of lcRows) {
    const row = get(r.buyExchange, r.sellExchange);
    row.lifecycles = r.n;
    row.maxLifecycleMs = r.max_dur ?? 0;
  }
  return Array.from(out.values()).sort((a, b) => b.rawCandidates - a.rawCandidates);
}

export function getTopLifecycles(runId: string, limit = 12): LifecycleAuditRow[] {
  const { db, exists } = getDb();
  if (!exists) return [];
  return db
    .prepare(
      `SELECT id,
              symbol,
              buy_exchange AS buyExchange,
              sell_exchange AS sellExchange,
              first_seen_at AS firstSeenAtMs,
              last_seen_at AS lastSeenAtMs,
              ended_at AS endedAtMs,
              duration_ms AS durationMs,
              COALESCE(duration_ms, last_seen_at - first_seen_at) AS effectiveDurationMs,
              observation_count AS observationCount,
              status,
              max_approximate_net_spread_pct AS maxApproxNetSpreadPct,
              max_net_profit_quote AS maxNetProfitQuote,
              max_supported_notional_quote AS maxSupportedNotionalQuote,
              event_key AS eventKey
       FROM cex_arbitrage_lifecycles
       WHERE run_id = ?
       ORDER BY effectiveDurationMs DESC, observation_count DESC, id DESC
       LIMIT ?`,
    )
    .all(runId, limit) as LifecycleAuditRow[];
}

export function getCandidatesOverTime(runId: string, buckets = 60): TimeBucket[] {
  const { db, exists } = getDb();
  if (!exists) return [];
  const range = db
    .prepare(
      `SELECT MIN(detected_at) AS first, MAX(detected_at) AS last
       FROM cex_arbitrage_candidates WHERE run_id = ?`,
    )
    .get(runId) as { first: number | null; last: number | null };
  if (range.first === null || range.last === null) return [];

  // Guard against zero-width range (single observation): widen to 60s either side.
  const span = Math.max(range.last - range.first, 60_000);
  const start = range.first;
  const bucketMs = Math.max(Math.ceil(span / buckets), 1_000);

  const rows = db
    .prepare(
      `SELECT (((detected_at - ?) / ?) ) AS bucket, COUNT(*) AS n
       FROM cex_arbitrage_candidates
       WHERE run_id = ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
    )
    .all(start, bucketMs, runId) as { bucket: number; n: number }[];

  return rows.map((r) => ({
    bucketStartMs: start + r.bucket * bucketMs,
    candidates: r.n,
  }));
}

function median(values: number[]): number {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1]! + vals[mid]!) / 2 : vals[mid]!;
}
