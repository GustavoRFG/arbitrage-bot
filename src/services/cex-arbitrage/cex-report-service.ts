import type { Database as BetterDb } from 'better-sqlite3';

// The CEX reporting layer surfaces four distinct counting units. Mixing them is
// the easiest way to misread a run, so every aggregate the report-cex CLI
// prints maps cleanly to exactly one of these:
//
//   1. Raw cross-exchange candidates       — rows in cex_arbitrage_candidates.
//                                            A candidate is one (symbol, buy
//                                            exchange, sell exchange) detection
//                                            at a single point in time.
//   2. Depth estimates calculated          — rows in cex_opportunity_estimates.
//                                            One per (candidate × target
//                                            notional), so it can exceed the
//                                            candidate count by the number of
//                                            configured target notionals.
//   3. Tradable estimates under prefunded
//      assumption                          — depth estimates with
//                                            tradable_prefunded = 1. Strict
//                                            subset of (2).
//   4. Distinct opportunity lifecycles     — rows in cex_arbitrage_lifecycles.
//                                            Many candidates can collapse into
//                                            one lifecycle when they share a
//                                            (symbol, route) inside the close
//                                            grace window.

export interface CexRunSummary {
  runId: string | null;                          // null = aggregate over all runs
  totalRuns: number;
  totalSnapshots: number;

  rawCandidates: number;                          // unit: candidates
  candidatesNetPositiveAfterFees: number;         // unit: candidates

  depthEstimatesCalculated: number;               // unit: estimates
  depthSupportedAt100: number;                    // unit: estimates @ $100
  depthSupportedAt500: number;                    // unit: estimates @ $500
  tradableEstimatesPrefunded: number;             // unit: estimates (subset of depthEstimatesCalculated)

  distinctOpportunityLifecycles: number;          // unit: lifecycles
  singleObservationLifecycles: number;            // unit: lifecycles with exactly one observation
  multiObservationLifecycles: number;             // unit: lifecycles with two or more observations

  maxNetProfitQuote: number;
  medianNetProfitQuote: number;
  topRoute: { buyExchange: string; sellExchange: string; count: number } | null;
  topSymbol: { symbol: string; count: number } | null;
  longestLifecycleMs: number;
  medianLifecycleMs: number;
}

export interface CexPerSymbolBreakdown {
  symbol: string;
  rawCandidates: number;
  depthEstimates: number;
  tradableEstimates: number;
  lifecycles: number;
}

export interface CexPerRouteBreakdown {
  buyExchange: string;
  sellExchange: string;
  rawCandidates: number;
  depthEstimates: number;
  tradableEstimates: number;
  lifecycles: number;
}

export interface CexLifecycleBestEstimate {
  estimateId: number;
  candidateId: number;
  detectedAtMs: number;
  targetNotionalQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  supportedByDepth: boolean;
  tradablePrefunded: boolean;
}

export interface CexLifecycleAuditRow {
  id: number;
  eventKey: string;
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
  maxGrossSpreadPct: number;
  maxApproxNetSpreadPct: number;
  maxNetProfitQuote: number;
  maxSupportedNotionalQuote: number;
  bestEstimate: CexLifecycleBestEstimate | null;
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
    const rawCandidates =
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
    const depthEstimatesCalculated =
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

    const distinctLifecycles =
      (this.db
        .prepare(`SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles ${where}`)
        .get(...args) as { n: number }).n;

    const singleObservationLifecycles =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles ${where}
           ${where ? 'AND' : 'WHERE'} observation_count = 1`,
        )
        .get(...args) as { n: number }).n;

    const multiObservationLifecycles =
      (this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cex_arbitrage_lifecycles ${where}
           ${where ? 'AND' : 'WHERE'} observation_count > 1`,
        )
        .get(...args) as { n: number }).n;

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
      rawCandidates,
      candidatesNetPositiveAfterFees: candNet,
      depthEstimatesCalculated,
      depthSupportedAt100: supported100,
      depthSupportedAt500: supported500,
      tradableEstimatesPrefunded: tradable,
      distinctOpportunityLifecycles: distinctLifecycles,
      singleObservationLifecycles,
      multiObservationLifecycles,
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

  bySymbol(runId?: string): CexPerSymbolBreakdown[] {
    // Use independent aggregations per counting layer so a LEFT JOIN between
    // candidates and estimates does not inflate the candidate count by the
    // number of target notionals.
    const candWhere = runId ? 'WHERE run_id = ?' : '';
    const estWhere = runId ? 'WHERE c.run_id = ?' : '';
    const lcWhere = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];

    const candRows = this.db
      .prepare(
        `SELECT symbol, COUNT(*) AS n
         FROM cex_arbitrage_candidates ${candWhere}
         GROUP BY symbol`,
      )
      .all(...args) as { symbol: string; n: number }[];

    const estRows = this.db
      .prepare(
        `SELECT c.symbol AS symbol,
                COUNT(*) AS depth_estimates,
                SUM(CASE WHEN e.tradable_prefunded = 1 THEN 1 ELSE 0 END) AS tradable_estimates
         FROM cex_opportunity_estimates e
         JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
         ${estWhere}
         GROUP BY c.symbol`,
      )
      .all(...args) as { symbol: string; depth_estimates: number; tradable_estimates: number }[];

    const lcRows = this.db
      .prepare(
        `SELECT symbol, COUNT(*) AS n
         FROM cex_arbitrage_lifecycles ${lcWhere}
         GROUP BY symbol`,
      )
      .all(...args) as { symbol: string; n: number }[];

    const merged = new Map<string, CexPerSymbolBreakdown>();
    const get = (symbol: string): CexPerSymbolBreakdown => {
      let row = merged.get(symbol);
      if (!row) {
        row = { symbol, rawCandidates: 0, depthEstimates: 0, tradableEstimates: 0, lifecycles: 0 };
        merged.set(symbol, row);
      }
      return row;
    };
    for (const r of candRows) get(r.symbol).rawCandidates = r.n;
    for (const r of estRows) {
      const row = get(r.symbol);
      row.depthEstimates = r.depth_estimates;
      row.tradableEstimates = r.tradable_estimates ?? 0;
    }
    for (const r of lcRows) get(r.symbol).lifecycles = r.n;

    return Array.from(merged.values()).sort((a, b) => b.rawCandidates - a.rawCandidates);
  }

  byRoute(runId?: string): CexPerRouteBreakdown[] {
    const candWhere = runId ? 'WHERE run_id = ?' : '';
    const estWhere = runId ? 'WHERE c.run_id = ?' : '';
    const lcWhere = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];

    const candRows = this.db
      .prepare(
        `SELECT buy_exchange AS buyExchange, sell_exchange AS sellExchange, COUNT(*) AS n
         FROM cex_arbitrage_candidates ${candWhere}
         GROUP BY buy_exchange, sell_exchange`,
      )
      .all(...args) as { buyExchange: string; sellExchange: string; n: number }[];

    const estRows = this.db
      .prepare(
        `SELECT c.buy_exchange AS buyExchange,
                c.sell_exchange AS sellExchange,
                COUNT(*) AS depth_estimates,
                SUM(CASE WHEN e.tradable_prefunded = 1 THEN 1 ELSE 0 END) AS tradable_estimates
         FROM cex_opportunity_estimates e
         JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
         ${estWhere}
         GROUP BY c.buy_exchange, c.sell_exchange`,
      )
      .all(...args) as {
        buyExchange: string;
        sellExchange: string;
        depth_estimates: number;
        tradable_estimates: number;
      }[];

    const lcRows = this.db
      .prepare(
        `SELECT buy_exchange AS buyExchange, sell_exchange AS sellExchange, COUNT(*) AS n
         FROM cex_arbitrage_lifecycles ${lcWhere}
         GROUP BY buy_exchange, sell_exchange`,
      )
      .all(...args) as { buyExchange: string; sellExchange: string; n: number }[];

    const key = (b: string, s: string): string => `${b}|${s}`;
    const merged = new Map<string, CexPerRouteBreakdown>();
    const get = (b: string, s: string): CexPerRouteBreakdown => {
      const k = key(b, s);
      let row = merged.get(k);
      if (!row) {
        row = {
          buyExchange: b,
          sellExchange: s,
          rawCandidates: 0,
          depthEstimates: 0,
          tradableEstimates: 0,
          lifecycles: 0,
        };
        merged.set(k, row);
      }
      return row;
    };
    for (const r of candRows) get(r.buyExchange, r.sellExchange).rawCandidates = r.n;
    for (const r of estRows) {
      const row = get(r.buyExchange, r.sellExchange);
      row.depthEstimates = r.depth_estimates;
      row.tradableEstimates = r.tradable_estimates ?? 0;
    }
    for (const r of lcRows) get(r.buyExchange, r.sellExchange).lifecycles = r.n;

    return Array.from(merged.values()).sort((a, b) => b.rawCandidates - a.rawCandidates);
  }

  topLifecycles(limit = 10, runId?: string): CexLifecycleAuditRow[] {
    const where = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];
    const lifecycles = this.db
      .prepare(
        `SELECT id,
                event_key AS eventKey,
                symbol,
                buy_exchange AS buyExchange,
                sell_exchange AS sellExchange,
                first_seen_at AS firstSeenAtMs,
                last_seen_at AS lastSeenAtMs,
                ended_at AS endedAtMs,
                duration_ms AS durationMs,
                (COALESCE(duration_ms, last_seen_at - first_seen_at)) AS effectiveDurationMs,
                observation_count AS observationCount,
                status,
                max_gross_spread_pct AS maxGrossSpreadPct,
                max_approximate_net_spread_pct AS maxApproxNetSpreadPct,
                max_net_profit_quote AS maxNetProfitQuote,
                max_supported_notional_quote AS maxSupportedNotionalQuote
         FROM cex_arbitrage_lifecycles ${where}
         ORDER BY effectiveDurationMs DESC, observation_count DESC, id DESC
         LIMIT ?`,
      )
      .all(...args, limit) as Omit<CexLifecycleAuditRow, 'bestEstimate'>[];

    return lifecycles.map((lifecycle) => ({
      ...lifecycle,
      bestEstimate: this.bestEstimateForLifecycle(lifecycle.id),
    }));
  }

  private bestEstimateForLifecycle(lifecycleId: number): CexLifecycleBestEstimate | null {
    const row = this.db
      .prepare(
        `SELECT e.id AS estimateId,
                c.id AS candidateId,
                c.detected_at AS detectedAtMs,
                e.target_notional_quote AS targetNotionalQuote,
                e.net_profit_quote AS netProfitQuote,
                e.net_spread_pct AS netSpreadPct,
                e.supported_by_depth AS supportedByDepth,
                e.tradable_prefunded AS tradablePrefunded
         FROM cex_opportunity_estimates e
         JOIN cex_arbitrage_candidates c ON c.id = e.candidate_id
         WHERE c.lifecycle_id = ?
         ORDER BY e.net_profit_quote DESC, e.net_spread_pct DESC, e.id DESC
         LIMIT 1`,
      )
      .get(lifecycleId) as
      | {
          estimateId: number;
          candidateId: number;
          detectedAtMs: number;
          targetNotionalQuote: number;
          netProfitQuote: number;
          netSpreadPct: number;
          supportedByDepth: 0 | 1;
          tradablePrefunded: 0 | 1;
        }
      | undefined;

    if (!row) return null;
    return {
      estimateId: row.estimateId,
      candidateId: row.candidateId,
      detectedAtMs: row.detectedAtMs,
      targetNotionalQuote: row.targetNotionalQuote,
      netProfitQuote: row.netProfitQuote,
      netSpreadPct: row.netSpreadPct,
      supportedByDepth: row.supportedByDepth === 1,
      tradablePrefunded: row.tradablePrefunded === 1,
    };
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
