import type { Database as BetterDb } from 'better-sqlite3';

export interface PolymarketRunSummary {
  runId: string | null;
  totalMarkets: number;
  totalReferenceSnapshots: number;
  totalClobSnapshots: number;
  totalFeatureSnapshots: number;
  totalCandidates: number;
  candidatesByType: { eventType: string; n: number }[];
  medianLagMs: number;
  maxLagMs: number;
  longestLifecycleMs: number;
}

export class PolymarketReportService {
  constructor(private readonly db: BetterDb) {}

  summary(runId?: string): PolymarketRunSummary {
    const where = runId ? 'WHERE run_id = ?' : '';
    const args = runId ? [runId] : [];

    const totalMarkets =
      (this.db.prepare(`SELECT COUNT(*) AS n FROM polymarket_short_horizon_markets`).get() as {
        n: number;
      }).n;
    const totalRef =
      (this.db
        .prepare(`SELECT COUNT(*) AS n FROM crypto_reference_snapshots ${where}`)
        .get(...args) as { n: number }).n;
    const totalClob =
      (this.db
        .prepare(`SELECT COUNT(*) AS n FROM polymarket_orderbook_snapshots ${where}`)
        .get(...args) as { n: number }).n;
    const totalFeat =
      (this.db.prepare(`SELECT COUNT(*) AS n FROM polymarket_feature_snapshots`).get() as {
        n: number;
      }).n;
    const totalCand =
      (this.db
        .prepare(`SELECT COUNT(*) AS n FROM repricing_lag_candidates ${where}`)
        .get(...args) as { n: number }).n;

    const byType = this.db
      .prepare(
        `SELECT event_type AS eventType, COUNT(*) AS n
         FROM repricing_lag_candidates ${where}
         GROUP BY event_type ORDER BY n DESC`,
      )
      .all(...args) as { eventType: string; n: number }[];

    const lagRows = this.db
      .prepare(
        `SELECT lag_ms_estimate AS v
         FROM repricing_lag_candidates ${where}
         ${where ? 'AND' : 'WHERE'} lag_ms_estimate IS NOT NULL`,
      )
      .all(...args) as { v: number }[];
    const lags = lagRows.map((r) => r.v).sort((a, b) => a - b);
    const medianLag = lags.length === 0 ? 0 : lags[Math.floor(lags.length / 2)] ?? 0;
    const maxLag = lags.length === 0 ? 0 : lags[lags.length - 1] ?? 0;

    const longest =
      (this.db
        .prepare(`SELECT COALESCE(MAX(duration_ms), 0) AS m FROM repricing_lag_lifecycles ${where}`)
        .get(...args) as { m: number }).m;

    return {
      runId: runId ?? null,
      totalMarkets,
      totalReferenceSnapshots: totalRef,
      totalClobSnapshots: totalClob,
      totalFeatureSnapshots: totalFeat,
      totalCandidates: totalCand,
      candidatesByType: byType,
      medianLagMs: medianLag,
      maxLagMs: maxLag,
      longestLifecycleMs: longest,
    };
  }
}
