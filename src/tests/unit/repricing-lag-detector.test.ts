import { describe, expect, it } from 'vitest';

import { detectRepricingLag } from '../../services/polymarket-repricing/repricing-lag-detector.js';

import type {
  CryptoReferenceSnapshot,
  PolymarketMarketSnapshot,
  PolymarketShortHorizonMarket,
} from '../../core/types/polymarket.js';

const market: PolymarketShortHorizonMarket = {
  id: 'm1',
  asset: 'BTC',
  horizon: '5m',
  startTimeMs: 1_000_000,
  endTimeMs: 1_300_000,
  referenceOpenPrice: 100_000,
};

const thresholds = {
  referenceMovePctThreshold: 0.05,           // 0.05 %
  distanceFromOpenPctThreshold: 0.03,        // 0.03 %
  lateWindowMaxTimeToExpiryMs: 30_000,
  maxClobStalenessMs: 5_000,
};

function ref(price: number, t: number): CryptoReferenceSnapshot {
  return { asset: 'BTC', source: 'binance', price, timestamps: { receivedAtMs: t } };
}

function clob(t: number, midpoint: number): PolymarketMarketSnapshot {
  return {
    marketId: 'm1',
    capturedAtMs: t,
    yesMidpoint: midpoint,
    noMidpoint: 1 - midpoint,
    yesDepthTopNQuote: 800,
    noDepthTopNQuote: 800,
  };
}

const feeAssumption = { source: 'unknown' as const };

describe('detectRepricingLag', () => {
  it('detects reference_move_clob_lag when ref jumps but CLOB midpoint stays put', () => {
    const now = 1_200_000;
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_000, now - 1_000), ref(100_500, now)],   // +0.5%
      clobFeed: [clob(now - 1_000, 0.50), clob(now, 0.50)],          // unchanged
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    const e = events.find((c) => c.eventType === 'reference_move_clob_lag');
    expect(e).toBeDefined();
    expect(e!.referenceMovePct).toBeGreaterThan(0);
    expect(e!.clobMidpointBefore).toBe(0.50);
    expect(e!.clobMidpointAfter).toBe(0.50);
  });

  it('does NOT raise reference_move_clob_lag when CLOB follows the reference', () => {
    const now = 1_200_000;
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_000, now - 1_000), ref(100_500, now)],
      clobFeed: [clob(now - 1_000, 0.50), clob(now, 0.65)],          // CLOB followed up
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    expect(events.find((c) => c.eventType === 'reference_move_clob_lag')).toBeUndefined();
  });

  it('detects late_window_repricing_lag when underlying is asymmetric near expiry but CLOB is ambivalent', () => {
    const now = 1_290_000; // 10 s left in the 5-minute window
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_500, now - 1_000), ref(100_500, now)],    // 0.5% above open
      clobFeed: [clob(now - 1_000, 0.50), clob(now, 0.50)],
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    const e = events.find((c) => c.eventType === 'late_window_repricing_lag');
    expect(e).toBeDefined();
    expect(e!.distanceFromOpenPct).toBeGreaterThan(0);
    expect(e!.timeToExpiryMs).toBeLessThanOrEqual(30_000);
  });

  it('does NOT raise late-window event when CLOB is already strongly favoring YES', () => {
    const now = 1_290_000;
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_500, now - 1_000), ref(100_500, now)],
      clobFeed: [clob(now - 1_000, 0.85), clob(now, 0.85)],
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    expect(events.find((c) => c.eventType === 'late_window_repricing_lag')).toBeUndefined();
  });

  it('respects CLOB staleness — no event from a stale snapshot', () => {
    const now = 1_200_000;
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_000, now - 1_000), ref(100_500, now)],
      clobFeed: [clob(now - 60_000, 0.50)],                          // 60s stale, threshold 5s
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    expect(events.length).toBe(0);
  });

  it('detects binance_chainlink_divergence when feeds disagree', () => {
    const now = 1_200_000;
    const chainlink: CryptoReferenceSnapshot[] = [
      { asset: 'BTC', source: 'chainlink', price: 100_000, timestamps: { receivedAtMs: now } },
    ];
    const events = detectRepricingLag({
      market,
      binanceFeed: [ref(100_100, now)],                              // +0.1%
      chainlinkFeed: chainlink,
      clobFeed: [clob(now, 0.5)],
      feeAssumption,
      thresholds,
      nowMs: now,
    });
    expect(events.find((c) => c.eventType === 'binance_chainlink_divergence')).toBeDefined();
  });
});
