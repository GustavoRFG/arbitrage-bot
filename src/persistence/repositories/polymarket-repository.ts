import type { Database as BetterDb } from 'better-sqlite3';

import type {
  PolymarketShortHorizonMarket,
  PolymarketMarketSnapshot,
  CryptoReferenceSnapshot,
  RepricingLagCandidate,
  PolymarketFeatureSnapshot,
} from '../../core/types/polymarket.js';

export class PolymarketMarketRepository {
  constructor(private readonly db: BetterDb) {}

  upsert(market: PolymarketShortHorizonMarket, rawMetadata?: unknown): void {
    this.db
      .prepare(
        `INSERT INTO polymarket_short_horizon_markets
         (id, slug, asset, horizon, start_time, end_time, yes_token_id, no_token_id,
          reference_open_price, fees_enabled, fee_params_json, tick_size, min_order_size,
          discovered_at, raw_metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           slug = excluded.slug,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           yes_token_id = excluded.yes_token_id,
           no_token_id = excluded.no_token_id,
           reference_open_price = COALESCE(excluded.reference_open_price, polymarket_short_horizon_markets.reference_open_price),
           fees_enabled = COALESCE(excluded.fees_enabled, polymarket_short_horizon_markets.fees_enabled),
           fee_params_json = COALESCE(excluded.fee_params_json, polymarket_short_horizon_markets.fee_params_json),
           tick_size = COALESCE(excluded.tick_size, polymarket_short_horizon_markets.tick_size),
           min_order_size = COALESCE(excluded.min_order_size, polymarket_short_horizon_markets.min_order_size)`,
      )
      .run(
        market.id,
        market.slug ?? null,
        market.asset,
        market.horizon,
        market.startTimeMs,
        market.endTimeMs,
        market.yesTokenId ?? null,
        market.noTokenId ?? null,
        market.referenceOpenPrice ?? null,
        market.feesEnabled === undefined ? null : market.feesEnabled ? 1 : 0,
        market.feeRate !== undefined ? JSON.stringify({ feeRate: market.feeRate }) : null,
        market.tickSize ?? null,
        market.minOrderSize ?? null,
        Date.now(),
        rawMetadata ? JSON.stringify(rawMetadata) : null,
      );
  }
}

export class PolymarketSnapshotRepository {
  constructor(private readonly db: BetterDb) {}

  insertOrderBook(runId: string | null, snap: PolymarketMarketSnapshot, side: 'YES' | 'NO' | 'BOTH'): number {
    const r = this.db
      .prepare(
        `INSERT INTO polymarket_orderbook_snapshots
         (run_id, market_id, token_side, source_timestamp, received_at, processed_at,
          best_bid, best_ask, midpoint, spread, depth_top_n_json, book_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        snap.marketId,
        side,
        null,
        snap.capturedAtMs,
        null,
        side === 'NO' ? snap.noBestBid ?? null : snap.yesBestBid ?? null,
        side === 'NO' ? snap.noBestAsk ?? null : snap.yesBestAsk ?? null,
        side === 'NO' ? snap.noMidpoint ?? null : snap.yesMidpoint ?? null,
        side === 'NO' ? snap.noSpread ?? null : snap.yesSpread ?? null,
        null,
        snap.rawBookHash ?? null,
      );
    return Number(r.lastInsertRowid);
  }

  insertFeatureSnapshot(snap: PolymarketFeatureSnapshot): number {
    const r = this.db
      .prepare(
        `INSERT INTO polymarket_feature_snapshots
         (market_id, captured_at, time_to_expiry_ms,
          distance_from_open_binance_pct, distance_from_open_chainlink_pct,
          binance_chainlink_deviation_pct,
          yes_midpoint, no_midpoint, yes_spread, no_spread,
          yes_depth_metric, no_depth_metric)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snap.marketId,
        snap.capturedAtMs,
        snap.timeToExpiryMs ?? null,
        snap.distanceFromOpenBinancePct ?? null,
        snap.distanceFromOpenChainlinkPct ?? null,
        snap.binanceChainlinkDeviationPct ?? null,
        snap.yesMidpoint ?? null,
        snap.noMidpoint ?? null,
        snap.yesSpread ?? null,
        snap.noSpread ?? null,
        snap.yesDepthMetric ?? null,
        snap.noDepthMetric ?? null,
      );
    return Number(r.lastInsertRowid);
  }
}

export class CryptoReferenceRepository {
  constructor(private readonly db: BetterDb) {}

  insert(runId: string | null, snap: CryptoReferenceSnapshot): number {
    const r = this.db
      .prepare(
        `INSERT INTO crypto_reference_snapshots
         (run_id, asset, source, price, source_timestamp, received_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        snap.asset,
        snap.source,
        snap.price,
        snap.timestamps.sourceTimestampMs ?? null,
        snap.timestamps.receivedAtMs,
        snap.timestamps.processedAtMs ?? null,
      );
    return Number(r.lastInsertRowid);
  }
}

export class RepricingEventRepository {
  constructor(private readonly db: BetterDb) {}

  insert(runId: string | null, c: RepricingLagCandidate): number {
    const r = this.db
      .prepare(
        `INSERT INTO repricing_lag_candidates
         (run_id, market_id, detected_at, event_type, reference_source,
          reference_move_pct, distance_from_open_pct, time_to_expiry_ms,
          clob_midpoint_before, clob_midpoint_current, lag_ms_estimate,
          liquidity_flag, theoretical_edge_flag, fee_assumptions_json, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        c.marketId,
        c.detectedAtMs,
        c.eventType,
        c.referenceSource,
        c.referenceMovePct ?? null,
        c.distanceFromOpenPct ?? null,
        c.timeToExpiryMs ?? null,
        c.clobMidpointBefore ?? null,
        c.clobMidpointAfter ?? null,
        c.lagMsEstimate ?? null,
        c.liquidityFlag ?? null,
        c.theoreticalEdgeFlag === undefined ? null : c.theoreticalEdgeFlag ? 1 : 0,
        c.feeAssumptions ? JSON.stringify(c.feeAssumptions) : null,
        c.notes ?? null,
      );
    return Number(r.lastInsertRowid);
  }
}
