import type { SourceTimestamps } from './timestamps.js';

export interface PolymarketShortHorizonMarket {
  id: string;                              // condition_id or stable internal id
  slug?: string;
  asset: 'BTC' | 'ETH' | 'SOL' | 'XRP' | string;
  horizon: '5m' | '15m' | string;
  startTimeMs: number;
  endTimeMs: number;
  yesTokenId?: string;
  noTokenId?: string;
  referenceOpenPrice?: number;             // price of the underlying when the window opened
  feesEnabled?: boolean;
  feeRate?: number;                        // decimal, if known from Gamma/CLOB metadata
  tickSize?: number;
  minOrderSize?: number;
}

export interface CryptoReferenceSnapshot {
  asset: string;
  source: 'binance' | 'chainlink';
  price: number;
  timestamps: SourceTimestamps;
}

/** A point-in-time snapshot of a Polymarket market's CLOB. */
export interface PolymarketMarketSnapshot {
  marketId: string;
  capturedAtMs: number;
  yesBestBid?: number;
  yesBestAsk?: number;
  yesMidpoint?: number;
  noBestBid?: number;
  noBestAsk?: number;
  noMidpoint?: number;
  yesSpread?: number;
  noSpread?: number;
  yesDepthTopNQuote?: number;
  noDepthTopNQuote?: number;
  rawBookHash?: string;
}

export interface PolymarketFeatureSnapshot {
  marketId: string;
  capturedAtMs: number;
  timeToExpiryMs?: number;
  distanceFromOpenBinancePct?: number;
  distanceFromOpenChainlinkPct?: number;
  binanceChainlinkDeviationPct?: number;
  yesMidpoint?: number;
  noMidpoint?: number;
  yesSpread?: number;
  noSpread?: number;
  yesDepthMetric?: number;
  noDepthMetric?: number;
}

export type RepricingLagEventType =
  | 'reference_move_clob_lag'
  | 'late_window_repricing_lag'
  | 'binance_chainlink_divergence';

export interface RepricingLagCandidate {
  marketId: string;
  asset: string;
  horizon: string;
  detectedAtMs: number;
  eventType: RepricingLagEventType;
  timeToExpiryMs?: number;
  referenceSource: 'binance' | 'chainlink' | 'both';
  referenceMovePct?: number;
  distanceFromOpenPct?: number;
  clobMidpointBefore?: number;
  clobMidpointAfter?: number;
  lagMsEstimate?: number;
  liquidityFlag?: 'sufficient' | 'thin' | 'unknown';
  theoreticalEdgeFlag?: boolean;
  /** Snapshot of the fee assumptions used to evaluate `theoreticalEdgeFlag`. */
  feeAssumptions?: {
    feeRate?: number;
    source: 'config' | 'api' | 'unknown';
  };
  notes?: string;
}
