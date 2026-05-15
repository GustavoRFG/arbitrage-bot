import type { Database as BetterDb } from 'better-sqlite3';

export interface CandidateInsert {
  runId: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  detectedAtMs: number;
  buyTopAsk: number;
  sellTopBid: number;
  grossSpreadPct: number;
  approximateNetSpreadPct: number;
  lifecycleId?: number;
}

export interface EstimateInsert {
  candidateId: number;
  targetNotionalQuote: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  executableBuyNotional: number;
  executableSellNotional: number;
  supportedByDepth: boolean;
  grossProfitQuote: number;
  feesQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  tradablePrefunded: boolean;
}

export class ArbitrageRepository {
  constructor(private readonly db: BetterDb) {}

  insertCandidate(c: CandidateInsert): number {
    const r = this.db
      .prepare(
        `INSERT INTO cex_arbitrage_candidates
         (run_id, symbol, buy_exchange, sell_exchange, detected_at,
          buy_top_ask, sell_top_bid, gross_spread_pct, approximate_net_spread_pct, lifecycle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.runId,
        c.symbol,
        c.buyExchange,
        c.sellExchange,
        c.detectedAtMs,
        c.buyTopAsk,
        c.sellTopBid,
        c.grossSpreadPct,
        c.approximateNetSpreadPct,
        c.lifecycleId ?? null,
      );
    return Number(r.lastInsertRowid);
  }

  insertEstimate(e: EstimateInsert): number {
    const r = this.db
      .prepare(
        `INSERT INTO cex_opportunity_estimates
         (candidate_id, target_notional_quote, avg_buy_price, avg_sell_price,
          executable_buy_notional, executable_sell_notional, supported_by_depth,
          gross_profit_quote, fees_quote, net_profit_quote, net_spread_pct,
          tradable_prefunded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.candidateId,
        e.targetNotionalQuote,
        e.avgBuyPrice,
        e.avgSellPrice,
        e.executableBuyNotional,
        e.executableSellNotional,
        e.supportedByDepth ? 1 : 0,
        e.grossProfitQuote,
        e.feesQuote,
        e.netProfitQuote,
        e.netSpreadPct,
        e.tradablePrefunded ? 1 : 0,
      );
    return Number(r.lastInsertRowid);
  }
}
