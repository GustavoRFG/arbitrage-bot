import type { Database as BetterDb } from 'better-sqlite3';

import type {
  PaperArbitrageTrade,
  PaperSimulationResult,
} from '../../services/cex-paper-execution/paper-trade-types.js';

/**
 * Persistence layer for Phase 2 paper-execution simulations.
 *
 * Each call to `record` writes one row to `paper_simulation_runs` plus the
 * trades it produced — wrapped in a transaction so multi-latency CLI calls
 * either commit fully or not at all.
 */
export class PaperSimulationRepository {
  constructor(private readonly db: BetterDb) {}

  record(result: PaperSimulationResult): void {
    const insertRun = this.db.prepare(
      `INSERT INTO paper_simulation_runs(
         simulation_run_id, source_scanner_run_id, created_at, policy_name,
         selection_mode, latency_ms, min_profit_quote, min_spread_pct,
         max_notional_quote, reentry_cooldown_ms, symbols_filter_json,
         routes_filter_json, initial_portfolio_json, final_portfolio_json,
         eligible_lifecycles, total_trades, total_rejected, rejections_json,
         total_net_profit_quote, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTrade = this.db.prepare(
      `INSERT INTO paper_arbitrage_trades(
         simulation_run_id, lifecycle_id, candidate_id, estimate_id, symbol,
         buy_venue, sell_venue, detected_at, executed_at, latency_ms,
         target_notional_quote, executable_buy_notional, executable_sell_notional,
         base_qty, avg_buy_price, avg_sell_price, fees_quote, net_profit_quote,
         net_spread_pct, buy_quote_delta, buy_base_delta, sell_base_delta,
         sell_quote_delta, policy_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      insertRun.run(
        result.simulationRunId,
        result.sourceScannerRunId,
        result.createdAtMs,
        result.policy.policyName,
        result.policy.selectionMode,
        result.latencyMs,
        result.policy.minNetProfitQuote,
        result.policy.minNetSpreadPct,
        result.policy.maxTargetNotionalQuote,
        result.policy.reentryCooldownMs ?? null,
        result.symbolsFilter ? JSON.stringify(result.symbolsFilter) : null,
        result.routesFilter ? JSON.stringify(result.routesFilter) : null,
        JSON.stringify(result.initialPortfolio),
        JSON.stringify(result.finalPortfolio),
        result.eligibleLifecycles,
        result.trades.length,
        result.rejections.length,
        JSON.stringify(result.rejectionsByReason),
        result.totalNetProfitQuote,
        'completed',
        null,
      );
      for (const t of result.trades) {
        insertTrade.run(
          result.simulationRunId,
          t.lifecycleId,
          t.candidateId,
          t.estimateId,
          t.symbol,
          t.buyVenue,
          t.sellVenue,
          t.detectedAtMs,
          t.executedAtMs,
          t.latencyMs,
          t.targetNotionalQuote,
          t.executableBuyNotional,
          t.executableSellNotional,
          t.baseQty,
          t.avgBuyPrice,
          t.avgSellPrice,
          t.feesQuote,
          t.netProfitQuote,
          t.netSpreadPct,
          t.buyQuoteDelta,
          t.buyBaseDelta,
          t.sellBaseDelta,
          t.sellQuoteDelta,
          t.policyName,
        );
      }
    });
    tx();
  }

  listRunsForScanner(scannerRunId: string): Array<{
    simulationRunId: string;
    createdAtMs: number;
    policyName: string;
    latencyMs: number;
    totalTrades: number;
    totalNetProfitQuote: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT simulation_run_id AS simulationRunId,
                created_at        AS createdAtMs,
                policy_name       AS policyName,
                latency_ms        AS latencyMs,
                total_trades      AS totalTrades,
                total_net_profit_quote AS totalNetProfitQuote
         FROM paper_simulation_runs
         WHERE source_scanner_run_id = ?
         ORDER BY created_at DESC, latency_ms ASC`,
      )
      .all(scannerRunId) as Array<{
      simulationRunId: string;
      createdAtMs: number;
      policyName: string;
      latencyMs: number;
      totalTrades: number;
      totalNetProfitQuote: number;
    }>;
    return rows;
  }

  loadTrades(simulationRunId: string): PaperArbitrageTrade[] {
    const rows = this.db
      .prepare(
        `SELECT lifecycle_id AS lifecycleId,
                candidate_id AS candidateId,
                estimate_id  AS estimateId,
                symbol,
                buy_venue  AS buyVenue,
                sell_venue AS sellVenue,
                detected_at AS detectedAtMs,
                executed_at AS executedAtMs,
                latency_ms  AS latencyMs,
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
                buy_base_delta  AS buyBaseDelta,
                sell_base_delta AS sellBaseDelta,
                sell_quote_delta AS sellQuoteDelta,
                policy_name AS policyName
         FROM paper_arbitrage_trades
         WHERE simulation_run_id = ?
         ORDER BY executed_at ASC, id ASC`,
      )
      .all(simulationRunId) as PaperArbitrageTrade[];
    return rows;
  }
}
