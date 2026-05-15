import type {
  CryptoReferenceSnapshot,
  PolymarketMarketSnapshot,
  PolymarketShortHorizonMarket,
  RepricingLagCandidate,
  RepricingLagEventType,
} from '../../core/types/polymarket.js';

export interface LagDetectorThresholds {
  /** A reference move bigger than this (in %) is "material". */
  referenceMovePctThreshold: number;
  /** Late-window: |distance from open| above this near expiry implies asymmetry. */
  distanceFromOpenPctThreshold: number;
  /** "Near expiry" means time-to-expiry below this many ms. */
  lateWindowMaxTimeToExpiryMs: number;
  /** Skip stale CLOB snapshots beyond this age (ms). */
  maxClobStalenessMs: number;
}

export interface FeeAssumption {
  feeRate?: number;
  source: 'config' | 'api' | 'unknown';
}

export interface DetectInput {
  market: PolymarketShortHorizonMarket;
  /** Most recent reference snapshots, ordered oldest -> newest. */
  binanceFeed: CryptoReferenceSnapshot[];
  /** Optional Chainlink feed, oldest -> newest. */
  chainlinkFeed?: CryptoReferenceSnapshot[];
  /** Most recent CLOB snapshots, ordered oldest -> newest. */
  clobFeed: PolymarketMarketSnapshot[];
  feeAssumption: FeeAssumption;
  thresholds: LagDetectorThresholds;
  nowMs: number;
}

/**
 * Pure function over recent snapshots. Emits zero or more event candidates.
 * The detector is intentionally simple in Phase 1: three observable patterns,
 * no machine-learnt fair-value model, no synthesised "alpha" signal.
 */
export function detectRepricingLag(input: DetectInput): RepricingLagCandidate[] {
  const out: RepricingLagCandidate[] = [];
  const { market, binanceFeed, chainlinkFeed, clobFeed, thresholds, nowMs } = input;

  if (clobFeed.length === 0 || binanceFeed.length === 0) return out;

  const lastClob = clobFeed[clobFeed.length - 1]!;
  if (nowMs - lastClob.capturedAtMs > thresholds.maxClobStalenessMs) return out;

  const lastBinance = binanceFeed[binanceFeed.length - 1]!;
  const timeToExpiryMs = market.endTimeMs - nowMs;

  // ----- Event A: reference move with no CLOB midpoint reaction --------------
  if (binanceFeed.length >= 2 && lastClob.yesMidpoint !== undefined) {
    const oldestRecent = binanceFeed[0]!;
    const refMovePct = ((lastBinance.price - oldestRecent.price) / oldestRecent.price) * 100;
    if (Math.abs(refMovePct) >= thresholds.referenceMovePctThreshold) {
      const midNow = lastClob.yesMidpoint;
      const midThen = clobFeed[0]?.yesMidpoint ?? midNow;
      const midMove = midNow - midThen;
      const sameDirection =
        refMovePct === 0 ? midMove === 0 : Math.sign(midMove) === Math.sign(refMovePct);
      if (!sameDirection || Math.abs(midMove) < 0.005) {
        out.push(
          buildCandidate(market, 'reference_move_clob_lag', 'binance', {
            detectedAtMs: nowMs,
            referenceMovePct: refMovePct,
            timeToExpiryMs,
            clobMidpointBefore: midThen,
            clobMidpointAfter: midNow,
            lagMsEstimate: lastClob.capturedAtMs - lastBinance.timestamps.receivedAtMs,
            liquidityFlag: liquidityFlag(lastClob),
            feeAssumption: input.feeAssumption,
          }),
        );
      }
    }
  }

  // ----- Event B: late-window asymmetry vs reference -----------------------
  if (
    timeToExpiryMs > 0 &&
    timeToExpiryMs <= thresholds.lateWindowMaxTimeToExpiryMs &&
    market.referenceOpenPrice !== undefined &&
    lastClob.yesMidpoint !== undefined
  ) {
    const distancePct =
      ((lastBinance.price - market.referenceOpenPrice) / market.referenceOpenPrice) * 100;
    if (Math.abs(distancePct) >= thresholds.distanceFromOpenPctThreshold) {
      // If the underlying is comfortably above open but YES midpoint is still
      // ambivalent (~0.5), the CLOB has not absorbed the asymmetry yet.
      const ambivalent = Math.abs(lastClob.yesMidpoint - 0.5) < 0.05;
      if (ambivalent) {
        out.push(
          buildCandidate(market, 'late_window_repricing_lag', 'binance', {
            detectedAtMs: nowMs,
            distanceFromOpenPct: distancePct,
            timeToExpiryMs,
            clobMidpointAfter: lastClob.yesMidpoint,
            liquidityFlag: liquidityFlag(lastClob),
            feeAssumption: input.feeAssumption,
            notes: 'underlying-asymmetric; CLOB midpoint near 0.5',
          }),
        );
      }
    }
  }

  // ----- Event C: Binance vs Chainlink divergence ---------------------------
  if (chainlinkFeed && chainlinkFeed.length > 0) {
    const lastChain = chainlinkFeed[chainlinkFeed.length - 1]!;
    const deviationPct =
      ((lastBinance.price - lastChain.price) / lastChain.price) * 100;
    if (Math.abs(deviationPct) >= thresholds.referenceMovePctThreshold / 2) {
      out.push(
        buildCandidate(market, 'binance_chainlink_divergence', 'both', {
          detectedAtMs: nowMs,
          referenceMovePct: deviationPct,
          timeToExpiryMs,
          liquidityFlag: liquidityFlag(lastClob),
          feeAssumption: input.feeAssumption,
        }),
      );
    }
  }

  return out;
}

function liquidityFlag(snap: PolymarketMarketSnapshot): 'sufficient' | 'thin' | 'unknown' {
  if (snap.yesDepthTopNQuote === undefined && snap.noDepthTopNQuote === undefined) return 'unknown';
  const total = (snap.yesDepthTopNQuote ?? 0) + (snap.noDepthTopNQuote ?? 0);
  if (total >= 1000) return 'sufficient';
  if (total > 0) return 'thin';
  return 'unknown';
}

function buildCandidate(
  market: PolymarketShortHorizonMarket,
  eventType: RepricingLagEventType,
  referenceSource: 'binance' | 'chainlink' | 'both',
  fields: Partial<RepricingLagCandidate> & { detectedAtMs: number; feeAssumption: FeeAssumption },
): RepricingLagCandidate {
  const c: RepricingLagCandidate = {
    marketId: market.id,
    asset: market.asset,
    horizon: market.horizon,
    eventType,
    referenceSource,
    detectedAtMs: fields.detectedAtMs,
    feeAssumptions: fields.feeAssumption,
  };
  if (fields.referenceMovePct !== undefined) c.referenceMovePct = fields.referenceMovePct;
  if (fields.distanceFromOpenPct !== undefined) c.distanceFromOpenPct = fields.distanceFromOpenPct;
  if (fields.timeToExpiryMs !== undefined) c.timeToExpiryMs = fields.timeToExpiryMs;
  if (fields.clobMidpointBefore !== undefined) c.clobMidpointBefore = fields.clobMidpointBefore;
  if (fields.clobMidpointAfter !== undefined) c.clobMidpointAfter = fields.clobMidpointAfter;
  if (fields.lagMsEstimate !== undefined) c.lagMsEstimate = fields.lagMsEstimate;
  if (fields.liquidityFlag !== undefined) c.liquidityFlag = fields.liquidityFlag;
  if (fields.theoreticalEdgeFlag !== undefined) c.theoreticalEdgeFlag = fields.theoreticalEdgeFlag;
  if (fields.notes !== undefined) c.notes = fields.notes;
  return c;
}
