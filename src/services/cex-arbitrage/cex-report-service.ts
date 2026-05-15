import type { Database as BetterDb } from 'better-sqlite3';

export interface CexRunSummary {
  runId: string | null;                          // null = aggregate over all runs
  totalRuns: number;
  totalSnapshots: number;
  totalCandidates: number;
  totalEstimates: number;
  candidatesNetPositiveAfterFees: number;
  depthSupportedAt100: number;
  depthSupportedAt500: number;
  tradablePrefunded: number;
  maxNetProfitQuote: number;
  medianNetProfitQuote: number;
  topRoute: { buyExchange: string; sellExchange: string; count: number } | null;
  topSymbol: { symbol: string; count: number } | null;
  longestLifecycleMs: number;
  medianLifecycleMs: number;
}

export class CexReportService {
  constructor(private readonly db: BetterDb) {}

  summary(runId?: string): CexRunSummary {
    const where = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];

    const totalRuns =
      (this.db.prepare(`SELECT COUNT(*) AS n FROM scanner_runs ${where}`).get(...args) as {
        n: number;
      }).n;
    const totalSnapshots =
      (this.db.prepare(`SELECT COUNT(*) AS n FROM cex_order_book_snapshots ${where}`).get(...args) as {
        n: number;
      }).n;
    const totalCandidates =
      (this.db.prepare(`SELECT COUNT(*) AS n FROM cex_arbitrage_candidates ${where}`).get(...args) as {
        n: number;
      }).n;

    const candNet =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_arbitrage_candidates ${where}
           ${where ? 'AND' : 'WHERE'} approximate_net_spread_pct > 0`,
        )
        .get(...args) as { n: number }).n;

    const estimateWhere = runId
      ? `WHERE c.run_id = ?`
      : '';
    const totalEstimates =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
           JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
           ${estimateWhere}`,
        )
        .get(...args) as { n: number }).n;

    const supported100 =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
           JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
           ${estimateWhere}
           ${runId ? 'AND' : 'WHERE'} e.target_notional_quote = 100 AND e.supported_by_depth = 1`,
        )
        .get(...args) as { n: number }).n;
    const supported500 =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
           JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
           ${estimateWhere}
           ${runId ? 'AND' : 'WHERE'} e.target_notional_quote = 500 AND e.supported_by_depth = 1`,
        )
        .get(...args) as { n: number }).n;

    const tradable =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_opportunity_estimates e
           JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
           ${estimateWhere}
           ${runId ? 'AND' : 'WHERE'} e.tradable_prefunded = 1`,
        )
        .get(...args) as { n: number }).n;

    const maxNet =
      (this.db
        .prepare(
          `SELECT COALESCE(MAX(e.net_profit_quote), 0) AS m
           FROM cex_opportunity_estimates e
           JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
           ${estimateWhere}`,
        )
        .get(...args) as { m: number }).m;

    const medianNet = this.median(
      `SELECT e.net_profit_quote AS v
       FROM cex_opportunity_estimates e
       JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
       ${estimateWhere}`,
      args,
    );

    const topRouteRow = this.db
      .prepare(
        `SELECT buy_exchange, sell_exchange, COUNT(*) AS n
         FROM cex_arbitrage_candidates ${where}
         GROUP BY buy_exchange, sell_exchange
         ORDER BY n DESC LIMIT 1`,
      )
      .get(...args) as { buy_exchange: string; sell_exchange: string; n: number } | undefined;

    const topSymbolRow = this.db
      .prepare(
        `SELECT symbol, COUNT(*) AS n
         FROM cex_arbitrage_candidates ${where}
         GROUP BY symbol
         ORDER BY n DESC LIMIT 1`,
      )
      .get(...args) as { symbol: string; n: number } | undefined;

    const longestLc =
      (this.db
        .prepare(
          `SELECT COALESCE(MAX(duration_ms), 0) AS m
           FROM cex_arbitrage_lifecycles ${where}`,
        )
        .get(...args) as { m: number }).m;

    const medianLc = this.median(
      `SELECT duration_ms AS v
       FROM cex_arbitrage_lifecycles ${where}
       ${where ? 'AND' : 'WHERE'} duration_ms IS NOT NULL`,
      args,
    );

    return {
      runId: runId ?? null,
      totalRuns,
      totalSnapshots,
      totalCandidates,
      totalEstimates,
      candidatesNetPositiveAfterFees: candNet,
      depthSupportedAt100: supported100,
      depthSupportedAt500: supported500,
      tradablePrefunded: tradable,
      maxNetProfitQuote: maxNet,
      medianNetProfitQuote: medianNet,
      topRoute: topRouteRow
        ? {
            buyExchange: topRouteRow.buy_exchange,
            sellExchange: topRouteRow.sell_exchange,
            count: topRouteRow.n,
          }
        : null,
      topSymbol: topSymbolRow ? { symbol: topSymbolRow.symbol, count: topSymbolRow.n } : null,
      longestLifecycleMs: longestLc,
      medianLifecycleMs: medianLc,
    };
  }

  bySymbol(runId?: string): { symbol: string; candidates: number; tradable: number }[] {
    const where = runId ? 'WHERE c.run_id = ?' : '';
    const args = runId ? [runId] : [];
    return this.db
      .prepare(
        `SELECT c.symbol AS symbol,
                COUNT(*) AS candidates,
                SUM(CASE WHEN e.tradable_prefunded = 1 THEN 1 ELSE 0 END) AS tradable
         FROM cex_arbitrage_candidates c
         LEFT JOIN cex_opportunity_estimates e ON e.candidate_id = c.id
         ${where}
         GROUP BY c.symbol
         ORDER BY candidates DESC`,
      )
      .all(...args) as { symbol: string; candidates: number; tradable: number }[];
  }

  byRoute(runId?: string): {
    buyExchange: string;
    sellExchange: string;
    candidates: number;
  }[] {
    const where = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];
    return this.db
      .prepare(
        `SELECT buy_exchange AS buyExchange, sell_exchange AS sellExchange,
                COUNT(*) AS candidates
         FROM cex_arbitrage_candidates ${where}
         GROUP BY buy_exchange, sell_exchange
         ORDER BY candidates DESC`,
      )
      .all(...args) as { buyExchange: string; sellExchange: string; candidates: number }[];
  }

  topLifecycles(
    limit = 10,
    runId?: string,
  ): {
    eventKey: string;
    symbol: string;
    buyExchange: string;
    sellExchange: string;
    durationMs: number | null;
    observationCount: number;
    maxNetProfitQuote: number;
    maxSupportedNotionalQuote: number;
  }[] {
    const where = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];
    return this.db
      .prepare(
        `SELECT event_key AS eventKey, symbol, buy_exchange AS buyExchange,
                sell_exchange AS sellExchange, duration_ms AS durationMs,
                observation_count AS observationCount,
                max_net_profit_quote AS maxNetProfitQuote,
                max_supported_notional_quote AS maxSupportedNotionalQuote
         FROM cex_arbitrage_lifecycles ${where}
         ORDER BY COALESCE(duration_ms, last_seen_at - first_seen_at) DESC
         LIMIT ?`,
      )
      .all(...args, limit) as ReturnType<CexReportService['topLifecycles']>;
  }

  private median(query: string, args: unknown[]): number {
    const rows = this.db.prepare(query).all(...args) as { v: number | null }[];
    const vals = rows.map((r) => r.v).filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length === 0) return 0;
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 === 0 ? (vals[mid - 1]! + vals[mid]!) / 2 : vals[mid]!;
  }
}
