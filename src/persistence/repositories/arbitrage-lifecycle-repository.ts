import type { Database as BetterDb } from 'better-sqlite3';

export interface CexLifecycleRow {
  id: number;
  runId: string;
  eventKey: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  observationCount: number;
  status: 'open' | 'closed';
  maxGrossSpreadPct: number;
  maxApproxNetSpreadPct: number;
  maxNetProfitQuote: number;
  maxSupportedNotionalQuote: number;
}

export interface UpsertLifecycleArgs {
  runId: string;
  eventKey: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  observedAtMs: number;
  grossSpreadPct: number;
  approxNetSpreadPct: number;
  netProfitQuote: number;
  supportedNotionalQuote: number;
}

export class ArbitrageLifecycleRepository {
  constructor(private readonly db: BetterDb) {}

  /** Insert if open lifecycle for `eventKey` doesn't exist; else update maxes. */
  upsertOpen(args: UpsertLifecycleArgs): number {
    const existing = this.db
      .prepare(
        `SELECT * FROM cex_arbitrage_lifecycles
         WHERE event_key = ? AND status = 'open'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(args.eventKey) as
      | {
          id: number;
          max_gross_spread_pct: number;
          max_approximate_net_spread_pct: number;
          max_net_profit_quote: number;
          max_supported_notional_quote: number;
        }
      | undefined;

    if (!existing) {
      const r = this.db
        .prepare(
          `INSERT INTO cex_arbitrage_lifecycles
           (run_id, event_key, symbol, buy_exchange, sell_exchange,
            first_seen_at, last_seen_at, observation_count, status,
            max_gross_spread_pct, max_approximate_net_spread_pct,
            max_net_profit_quote, max_supported_notional_quote)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'open', ?, ?, ?, ?)`,
        )
        .run(
          args.runId,
          args.eventKey,
          args.symbol,
          args.buyExchange,
          args.sellExchange,
          args.observedAtMs,
          args.observedAtMs,
          args.grossSpreadPct,
          args.approxNetSpreadPct,
          args.netProfitQuote,
          args.supportedNotionalQuote,
        );
      return Number(r.lastInsertRowid);
    }

    this.db
      .prepare(
        `UPDATE cex_arbitrage_lifecycles
         SET last_seen_at = ?, observation_count = observation_count + 1,
             max_gross_spread_pct = MAX(max_gross_spread_pct, ?),
             max_approximate_net_spread_pct = MAX(max_approximate_net_spread_pct, ?),
             max_net_profit_quote = MAX(max_net_profit_quote, ?),
             max_supported_notional_quote = MAX(max_supported_notional_quote, ?)
         WHERE id = ?`,
      )
      .run(
        args.observedAtMs,
        args.grossSpreadPct,
        args.approxNetSpreadPct,
        args.netProfitQuote,
        args.supportedNotionalQuote,
        existing.id,
      );
    return existing.id;
  }

  /** Close any open lifecycles whose last sighting is older than `cutoffMs`. */
  closeStale(cutoffMs: number, nowMs: number): number {
    const r = this.db
      .prepare(
        `UPDATE cex_arbitrage_lifecycles
         SET status = 'closed', ended_at = last_seen_at,
             duration_ms = (last_seen_at - first_seen_at)
         WHERE status = 'open' AND last_seen_at < ?`,
      )
      .run(cutoffMs);
    return r.changes;
  }
}
