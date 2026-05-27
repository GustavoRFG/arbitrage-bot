/**
 * Phase 2.6 — paper-comparison persistence.
 *
 * Writes the output of `runComparison()` (a `ComparisonReport`) into the
 * `paper_comparison_runs` + `paper_comparison_scenarios` tables introduced
 * by migration 005. The dashboard then reads these rows read-only to
 * render the `/compare` page and the raw/actionable/capturable cards on
 * the Overview page.
 *
 * One repo call per CLI invocation. Persistence is transactional: if any
 * scenario insert fails the run row is rolled back too, so we never leave
 * orphan comparison metadata.
 */

import type { Database as BetterDb } from 'better-sqlite3';

import type {
  ComparisonCell,
  ComparisonReport,
  ContentionMode,
} from '../../services/cex-paper-execution/simulation-comparison.js';
import type { RejectionReason } from '../../services/cex-paper-execution/paper-trade-types.js';

export interface PersistComparisonInput {
  comparisonRunId: string;
  createdAtMs: number;
  report: ComparisonReport;
  label?: string | null;
  symbolsFilter?: string[] | null;
  routesFilter?: Array<[string, string]> | null;
  eligibleLifecycles: number;
}

export interface PersistComparisonResult {
  comparisonRunId: string;
  scenarioCount: number;
  bestPresetName: string | null;
  bestLatencyMs: number | null;
  bestTotalNetProfitQuote: number | null;
  totalMissedProfitQuote: number;
  topBottleneckReason: string | null;
}

function pickTopBottleneck(
  missedProfitByReason: Record<RejectionReason, number>,
): { reason: RejectionReason | null; missed: number } {
  let bestReason: RejectionReason | null = null;
  let bestMissed = 0;
  for (const [reason, missed] of Object.entries(missedProfitByReason) as Array<
    [RejectionReason, number]
  >) {
    if (missed > bestMissed) {
      bestMissed = missed;
      bestReason = reason;
    }
  }
  return { reason: bestReason, missed: bestMissed };
}

export class PaperComparisonRepository {
  constructor(private readonly db: BetterDb) {}

  persist(input: PersistComparisonInput): PersistComparisonResult {
    const insertRun = this.db.prepare(
      `INSERT INTO paper_comparison_runs(
         comparison_run_id, source_scanner_run_id, created_at, label,
         policy_name, selection_mode, min_profit_quote, min_spread_pct,
         max_notional_quote, reentry_cooldown_ms, contention_mode,
         latencies_json, presets_json, symbols_filter_json, routes_filter_json,
         eligible_lifecycles, cell_count, best_total_net_profit_quote,
         best_preset, best_latency_ms, total_missed_profit_quote,
         top_bottleneck_reason, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertScenario = this.db.prepare(
      `INSERT INTO paper_comparison_scenarios(
         comparison_run_id, simulation_run_id, preset_name, preset_label,
         latency_ms, contention_mode, executed_trades,
         total_net_profit_quote, total_missed_profit_quote,
         rejections_by_reason_json, missed_profit_by_reason_json,
         top_bottleneck_reason, initial_portfolio_json, final_portfolio_json,
         final_inventory_drift_json, top_executed_json, top_missed_json,
         top_routes_paper_pnl_json, top_routes_missed_pnl_json,
         top_symbols_efficiency_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const { report } = input;

    // Roll up "best" + "top bottleneck" across cells before writing.
    let bestCell: ComparisonCell | null = null;
    let totalMissed = 0;
    const aggregateMissedByReason: Record<RejectionReason, number> = {
      no_eligible_estimate: 0,
      below_threshold: 0,
      latency_expired: 0,
      insufficient_quote_inventory: 0,
      insufficient_base_inventory: 0,
      lifecycle_too_short_for_latency: 0,
    };
    for (const cell of report.cells) {
      if (!bestCell || cell.totalNetProfitQuote > bestCell.totalNetProfitQuote) {
        bestCell = cell;
      }
      totalMissed += cell.missed.totalMissedProfitQuote;
      for (const [reason, value] of Object.entries(cell.missed.missedProfitByReason) as Array<
        [RejectionReason, number]
      >) {
        aggregateMissedByReason[reason] += value;
      }
    }
    const topBottleneck = pickTopBottleneck(aggregateMissedByReason);

    const presetSummary = uniquePresets(report.cells).map((p) => ({
      name: p.name,
      label: p.label,
    }));

    const tx = this.db.transaction(() => {
      insertRun.run(
        input.comparisonRunId,
        report.sourceScannerRunId,
        input.createdAtMs,
        input.label ?? null,
        report.policy.policyName,
        report.policy.selectionMode,
        report.policy.minNetProfitQuote,
        report.policy.minNetSpreadPct,
        report.policy.maxTargetNotionalQuote,
        report.policy.reentryCooldownMs ?? null,
        report.contentionMode,
        JSON.stringify(report.latenciesMs),
        JSON.stringify(presetSummary),
        input.symbolsFilter && input.symbolsFilter.length > 0
          ? JSON.stringify(input.symbolsFilter)
          : null,
        input.routesFilter && input.routesFilter.length > 0
          ? JSON.stringify(input.routesFilter)
          : null,
        input.eligibleLifecycles,
        report.cells.length,
        bestCell?.totalNetProfitQuote ?? null,
        bestCell?.presetName ?? null,
        bestCell?.latencyMs ?? null,
        totalMissed,
        topBottleneck.reason,
        null,
      );

      for (const cell of report.cells) {
        const cellBottleneck = pickTopBottleneck(cell.missed.missedProfitByReason);
        insertScenario.run(
          input.comparisonRunId,
          cell.simulationRunId,
          cell.presetName,
          cell.presetLabel,
          cell.latencyMs,
          cell.contentionMode,
          cell.executedTrades,
          cell.totalNetProfitQuote,
          cell.missed.totalMissedProfitQuote,
          JSON.stringify(cell.rejectionsByReason),
          JSON.stringify(cell.missed.missedProfitByReason),
          cellBottleneck.reason,
          JSON.stringify(cell.initialPortfolio),
          JSON.stringify(cell.finalPortfolio),
          JSON.stringify(cell.finalInventoryDrift),
          JSON.stringify(cell.topExecuted),
          JSON.stringify(cell.topMissed),
          JSON.stringify(cell.topRoutesPaperPnL),
          JSON.stringify(cell.topRoutesMissedPnL),
          JSON.stringify(cell.topSymbolsEfficiency),
        );
      }
    });
    tx();

    return {
      comparisonRunId: input.comparisonRunId,
      scenarioCount: report.cells.length,
      bestPresetName: bestCell?.presetName ?? null,
      bestLatencyMs: bestCell?.latencyMs ?? null,
      bestTotalNetProfitQuote: bestCell?.totalNetProfitQuote ?? null,
      totalMissedProfitQuote: totalMissed,
      topBottleneckReason: topBottleneck.reason,
    };
  }

  hasComparisonForScanner(scannerRunId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS one FROM paper_comparison_runs
         WHERE source_scanner_run_id = ? LIMIT 1`,
      )
      .get(scannerRunId) as { one: number } | undefined;
    return Boolean(row);
  }
}

function uniquePresets(cells: ComparisonCell[]): Array<{ name: string; label: string }> {
  const seen = new Map<string, { name: string; label: string }>();
  for (const c of cells) {
    if (!seen.has(c.presetName)) {
      seen.set(c.presetName, { name: c.presetName, label: c.presetLabel });
    }
  }
  return Array.from(seen.values());
}

/** Used by the CLI to derive a stable id for one comparison invocation. */
export function newComparisonRunId(prefix: string, createdAtMs: number): string {
  // 8-char random suffix is plenty for local-only uniqueness.
  const suffix = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${prefix}_${createdAtMs}_${suffix}`;
}

// Re-export so callers don't import directly from simulation-comparison just
// for the type label.
export type { ContentionMode };
