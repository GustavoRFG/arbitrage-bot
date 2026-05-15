import type {
  CryptoReferenceSnapshot,
  PolymarketFeatureSnapshot,
  PolymarketMarketSnapshot,
  PolymarketShortHorizonMarket,
} from '../../core/types/polymarket.js';

export interface FeatureBuildInput {
  market: PolymarketShortHorizonMarket;
  clob: PolymarketMarketSnapshot;
  binance?: CryptoReferenceSnapshot;
  chainlink?: CryptoReferenceSnapshot;
  nowMs: number;
}

export function buildFeatureSnapshot(input: FeatureBuildInput): PolymarketFeatureSnapshot {
  const { market, clob, binance, chainlink, nowMs } = input;
  const open = market.referenceOpenPrice;

  const distanceBinancePct =
    binance && open !== undefined && open !== 0
      ? ((binance.price - open) / open) * 100
      : undefined;
  const distanceChainlinkPct =
    chainlink && open !== undefined && open !== 0
      ? ((chainlink.price - open) / open) * 100
      : undefined;
  const binanceChainlinkDeviationPct =
    binance && chainlink && chainlink.price !== 0
      ? ((binance.price - chainlink.price) / chainlink.price) * 100
      : undefined;

  const result: PolymarketFeatureSnapshot = {
    marketId: market.id,
    capturedAtMs: clob.capturedAtMs,
  };
  result.timeToExpiryMs = market.endTimeMs - nowMs;
  if (distanceBinancePct !== undefined) result.distanceFromOpenBinancePct = distanceBinancePct;
  if (distanceChainlinkPct !== undefined) result.distanceFromOpenChainlinkPct = distanceChainlinkPct;
  if (binanceChainlinkDeviationPct !== undefined)
    result.binanceChainlinkDeviationPct = binanceChainlinkDeviationPct;
  if (clob.yesMidpoint !== undefined) result.yesMidpoint = clob.yesMidpoint;
  if (clob.noMidpoint !== undefined) result.noMidpoint = clob.noMidpoint;
  if (clob.yesSpread !== undefined) result.yesSpread = clob.yesSpread;
  if (clob.noSpread !== undefined) result.noSpread = clob.noSpread;
  if (clob.yesDepthTopNQuote !== undefined) result.yesDepthMetric = clob.yesDepthTopNQuote;
  if (clob.noDepthTopNQuote !== undefined) result.noDepthMetric = clob.noDepthTopNQuote;
  return result;
}
