import type { Database as BetterDb } from 'better-sqlite3';

import type { CandidateEstimateRow, LifecycleWithEstimates } from './paper-trade-types.js';

export interface CandidateReplayFilter {
  symbols?: string[];
  /** Array of [buyVenue, sellVenue] pairs. */
  routes?: Array<[string, string]>;
}

interface LifecycleRow {
  id: number;
  symbol: string;
  buy_exchange: string;
  sell_exchange: string;
  first_seen_at: number;
  last_seen_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  observation_count: number;
}

interface EstimateRow {
  lifecycle_id: number | null;
  estimate_id: number;
  candidate_id: number;
  detected_at: number;
  target_notional_quote: number;
  executable_buy_notional: number;
  executable_sell_notional: number;
  avg_buy_price: number;
  avg_sell_price: number;
  fees_quote: number;
  net_profit_quote: number;
  net_spread_pct: number;
  supported_by_depth: 0 | 1;
  tradable_prefunded: 0 | 1;
}

/**
 * Loads every lifecycle for a scanner run together with the estimates attached
 * to its candidates, optionally filtered by symbol and/or route.
 *
 * Estimates are returned sorted by `detected_at` ascending so the latency
 * replay can pick "the first eligible estimate at or after t0+L".
 */
export class CandidateReplayLoader {
  constructor(private readonly db: BetterDb) {}

  scannerRunExists(scannerRunId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS one FROM scanner_runs WHERE run_id = ?')
      .get(scannerRunId) as { one: number } | undefined;
    return row !== undefined;
  }

  load(scannerRunId: string, filter: CandidateReplayFilter = {}): LifecycleWithEstimates[] {
    const where: string[] = ['run_id = ?'];
    const args: unknown[] = [scannerRunId];

    if (filter.symbols && filter.symbols.length > 0) {
      where.push(`symbol IN (${filter.symbols.map(() => '?').join(',')})`);
      args.push(...filter.symbols);
    }
    if (filter.routes && filter.routes.length > 0) {
      const orParts = filter.routes.map(() => '(buy_exchange = ? AND sell_exchange = ?)');
      where.push(`(${orParts.join(' OR ')})`);
      for (const [buy, sell] of filter.routes) args.push(buy, sell);
    }

    const lifecycleRows = this.db
      .prepare(
        `SELECT id, symbol, buy_exchange, sell_exchange,
                first_seen_at, last_seen_at, ended_at, duration_ms,
                observation_count
         FROM cex_arbitrage_lifecycles
         WHERE ${where.join(' AND ')}
         ORDER BY first_seen_at ASC, id ASC`,
      )
      .all(...args) as LifecycleRow[];

    if (lifecycleRows.length === 0) return [];

    const ids = lifecycleRows.map((l) => l.id);
    const placeholders = ids.map(() => '?').join(',');
    const estRows = this.db
      .prepare(
        `SELECT c.lifecycle_id AS lifecycle_id,
                e.id AS estimate_id,
                c.id AS candidate_id,
                c.detected_at AS detected_at,
                e.target_notional_quote AS target_notional_quote,
                e.executable_buy_notional AS executable_buy_notional,
                e.executable_sell_notional AS executable_sell_notional,
                e.avg_buy_price AS avg_buy_price,
                e.avg_sell_price AS avg_sell_price,
                e.fees_quote AS fees_quote,
                e.net_profit_quote AS net_profit_quote,
                e.net_spread_pct AS net_spread_pct,
                e.supported_by_depth AS supported_by_depth,
                e.tradable_prefunded AS tradable_prefunded
         FROM cex_opportunity_estimates e
         JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
         WHERE c.lifecycle_id IN (${placeholders})
         ORDER BY c.detected_at ASC, e.id ASC`,
      )
      .all(...ids) as EstimateRow[];

    const byLifecycle = new Map<number, CandidateEstimateRow[]>();
    for (const row of estRows) {
      if (row.lifecycle_id === null) continue;
      const arr = byLifecycle.get(row.lifecycle_id) ?? [];
      arr.push({
        estimateId: row.estimate_id,
        candidateId: row.candidate_id,
        detectedAtMs: row.detected_at,
        targetNotionalQuote: row.target_notional_quote,
        executableBuyNotional: row.executable_buy_notional,
        executableSellNotional: row.executable_sell_notional,
        avgBuyPrice: row.avg_buy_price,
        avgSellPrice: row.avg_sell_price,
        feesQuote: row.fees_quote,
        netProfitQuote: row.net_profit_quote,
        netSpreadPct: row.net_spread_pct,
        supportedByDepth: row.supported_by_depth === 1,
        tradablePrefunded: row.tradable_prefunded === 1,
      });
      byLifecycle.set(row.lifecycle_id, arr);
    }

    return lifecycleRows.map((lc) => {
      const effectiveDuration = lc.duration_ms ?? lc.last_seen_at - lc.first_seen_at;
      return {
        lifecycleId: lc.id,
        symbol: lc.symbol,
        buyVenue: lc.buy_exchange,
        sellVenue: lc.sell_exchange,
        firstSeenAtMs: lc.first_seen_at,
        lastSeenAtMs: lc.last_seen_at,
        endedAtMs: lc.ended_at,
        durationMs: effectiveDuration,
        observationCount: lc.observation_count,
        estimates: byLifecycle.get(lc.id) ?? [],
      };
    });
  }
}
