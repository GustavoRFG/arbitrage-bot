/**
 * Phase 2.6.1 — Runs page query helpers.
 *
 * Combines scanner-run metadata, legacy paper-simulation roll-ups,
 * comparison-run roll-ups, and dashboard-level stale classification
 * into the rows the Runs page renders. Strictly read-only.
 */

import { getDb } from '../db';
import { listScannerRuns, type ScannerRunRow, type UniverseMetadata } from './observatory';
import { hasPaperComparisonSchema, type ComparisonRunRow } from './comparison';
import { listSimulationRunsForScanner, type RejectionReason } from './simulator';
import {
  classifyRun,
  runSortKey,
  type RunClassification,
  type VisualRunStatus,
} from '../runs-classification';

export interface RunsPageScannerRow {
  // Scanner metadata.
  run: ScannerRunRow & { universe: UniverseMetadata | null };
  classification: RunClassification;
  visualStatus: VisualRunStatus;
  lastActivityAtMs: number | null;

  // Legacy single-scenario paper-simulation roll-up.
  legacySimCount: number;
  legacySimBestPnL: number | null;
  legacySimTotalTrades: number;

  // Comparison roll-up.
  comparisonCount: number;
  latestComparisonId: string | null;
  latestComparisonCreatedAtMs: number | null;
  latestComparisonLabel: string | null;
  bestComparisonId: string | null;
  bestComparisonPnL: number | null;
  bestComparisonPreset: string | null;
  bestComparisonLatencyMs: number | null;
  bestComparisonTotalMissedPnL: number | null;
  bestComparisonTopBottleneck: RejectionReason | null;
}

function getLastActivityByScannerRun(runIds: string[]): Map<string, number> {
  const { db, exists } = getDb();
  if (!exists || runIds.length === 0) return new Map();

  const placeholders = runIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT runId, MAX(activityAtMs) AS lastActivityAtMs
       FROM (
         SELECT run_id AS runId, MAX(received_at) AS activityAtMs
         FROM cex_order_book_snapshots
         WHERE run_id IN (${placeholders})
         GROUP BY run_id
         UNION ALL
         SELECT run_id AS runId, MAX(detected_at) AS activityAtMs
         FROM cex_arbitrage_candidates
         WHERE run_id IN (${placeholders})
         GROUP BY run_id
       )
       GROUP BY runId`,
    )
    .all(...runIds, ...runIds) as Array<{ runId: string; lastActivityAtMs: number | null }>;

  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.lastActivityAtMs !== null) out.set(row.runId, row.lastActivityAtMs);
  }
  return out;
}

export interface ComparisonRunsListRow {
  comparisonRunId: string;
  sourceScannerRunId: string;
  label: string | null;
  createdAtMs: number;
  policyName: string;
  selectionMode: string;
  contentionMode: 'single_route' | 'multi_route';
  scenarioCount: number;
  bestPreset: string | null;
  bestLatencyMs: number | null;
  bestTotalNetProfitQuote: number | null;
  totalMissedProfitQuote: number | null;
  topBottleneckReason: RejectionReason | null;
}

function _allComparisonRuns(): ComparisonRunRow[] {
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
       ORDER BY created_at DESC`,
    )
    .all() as ComparisonRunRow[];
}

/**
 * Build the per-scanner row payload the Runs page renders. Single SQL pass
 * for comparison runs (one prepared statement, not N+1).
 */
export function getRunsPageScannerRows(opts: { limit?: number; now?: number } = {}): RunsPageScannerRow[] {
  const runs = listScannerRuns(opts.limit ?? 50);
  if (runs.length === 0) return [];

  // Pre-index comparison runs by scanner_run.
  const allComparisons = _allComparisonRuns();
  const lastActivityByScanner = getLastActivityByScannerRun(runs.map((run) => run.runId));
  const byScanner = new Map<string, ComparisonRunRow[]>();
  for (const cmp of allComparisons) {
    const bucket = byScanner.get(cmp.sourceScannerRunId);
    if (bucket) bucket.push(cmp);
    else byScanner.set(cmp.sourceScannerRunId, [cmp]);
  }

  const rows: RunsPageScannerRow[] = runs.map((run) => {
    const lastActivityAtMs = lastActivityByScanner.get(run.runId) ?? null;
    const sims = listSimulationRunsForScanner(run.runId);
    const legacySimBestPnL =
      sims.length > 0 ? Math.max(...sims.map((s) => s.totalNetProfitQuote)) : null;
    const legacySimTotalTrades = sims.reduce((acc, s) => acc + s.totalTrades, 0);

    const comparisons = byScanner.get(run.runId) ?? [];
    const latest = comparisons[0] ?? null; // already DESC by created_at
    const best = comparisons.reduce<ComparisonRunRow | null>((acc, c) => {
      const pnl = c.bestTotalNetProfitQuote ?? -Infinity;
      const accPnl = acc?.bestTotalNetProfitQuote ?? -Infinity;
      return pnl > accPnl ? c : acc;
    }, null);

    const classification = classifyRun(
      {
        status: run.status,
        startedAtMs: run.startedAtMs,
        endedAtMs: run.endedAtMs,
        lastActivityAtMs,
        totalCycles: run.totalCycles,
        totalSymbolsScanned: run.totalSymbolsScanned,
        totalCandidates: run.totalCandidates,
      },
      opts.now !== undefined ? { now: opts.now } : {},
    );

    return {
      run,
      classification,
      visualStatus: classification.visualStatus,
      lastActivityAtMs,
      legacySimCount: sims.length,
      legacySimBestPnL,
      legacySimTotalTrades,
      comparisonCount: comparisons.length,
      latestComparisonId: latest?.comparisonRunId ?? null,
      latestComparisonCreatedAtMs: latest?.createdAtMs ?? null,
      latestComparisonLabel: latest?.label ?? null,
      bestComparisonId: best?.comparisonRunId ?? null,
      bestComparisonPnL: best?.bestTotalNetProfitQuote ?? null,
      bestComparisonPreset: best?.bestPreset ?? null,
      bestComparisonLatencyMs: best?.bestLatencyMs ?? null,
      bestComparisonTotalMissedPnL: best?.totalMissedProfitQuote ?? null,
      bestComparisonTopBottleneck:
        (best?.topBottleneckReason ?? latest?.topBottleneckReason ?? null) as RejectionReason | null,
    };
  });

  rows.sort((a, b) => {
    const keyA = runSortKey(a.visualStatus, a.run.totalCandidates > 0, a.run.startedAtMs);
    const keyB = runSortKey(b.visualStatus, b.run.totalCandidates > 0, b.run.startedAtMs);
    if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];
    return keyA[1] - keyB[1];
  });

  return rows;
}

/** Latest comparison runs across every scanner run, newest first. */
export function listLatestComparisonRuns(limit = 50): ComparisonRunsListRow[] {
  const { db, exists } = getDb();
  if (!exists || !hasPaperComparisonSchema(db)) return [];
  type Raw = {
    comparisonRunId: string;
    sourceScannerRunId: string;
    label: string | null;
    createdAtMs: number;
    policyName: string;
    selectionMode: string;
    contentionMode: 'single_route' | 'multi_route';
    cellCount: number;
    bestTotalNetProfitQuote: number | null;
    bestPreset: string | null;
    bestLatencyMs: number | null;
    totalMissedProfitQuote: number | null;
    topBottleneckReason: RejectionReason | null;
  };
  const rows = db
    .prepare(
      `SELECT comparison_run_id           AS comparisonRunId,
              source_scanner_run_id       AS sourceScannerRunId,
              label,
              created_at                  AS createdAtMs,
              policy_name                 AS policyName,
              selection_mode              AS selectionMode,
              contention_mode             AS contentionMode,
              cell_count                  AS cellCount,
              best_total_net_profit_quote AS bestTotalNetProfitQuote,
              best_preset                 AS bestPreset,
              best_latency_ms             AS bestLatencyMs,
              total_missed_profit_quote   AS totalMissedProfitQuote,
              top_bottleneck_reason       AS topBottleneckReason
       FROM paper_comparison_runs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Raw[];
  return rows.map((r) => ({
    comparisonRunId: r.comparisonRunId,
    sourceScannerRunId: r.sourceScannerRunId,
    label: r.label,
    createdAtMs: r.createdAtMs,
    policyName: r.policyName,
    selectionMode: r.selectionMode,
    contentionMode: r.contentionMode,
    scenarioCount: r.cellCount,
    bestPreset: r.bestPreset,
    bestLatencyMs: r.bestLatencyMs,
    bestTotalNetProfitQuote: r.bestTotalNetProfitQuote,
    totalMissedProfitQuote: r.totalMissedProfitQuote,
    topBottleneckReason: r.topBottleneckReason,
  }));
}

/** Convenience: best scanner_run that has at least one comparison. */
export function getScannerRunWithBestComparison(): RunsPageScannerRow | null {
  const rows = getRunsPageScannerRows();
  let best: RunsPageScannerRow | null = null;
  for (const r of rows) {
    if (r.bestComparisonPnL === null) continue;
    if (best === null || (r.bestComparisonPnL ?? -Infinity) > (best.bestComparisonPnL ?? -Infinity)) {
      best = r;
    }
  }
  return best;
}
