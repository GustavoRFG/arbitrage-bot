import { describe, expect, it } from 'vitest';

import { buildFeatureSnapshot } from '../../services/polymarket-repricing/polymarket-features.js';

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
  endTimeMs: 1_300_000, // 5 minutes window
  yesTokenId: 'yes',
  noTokenId: 'no',
  referenceOpenPrice: 100_000,
};

const clob: PolymarketMarketSnapshot = {
  marketId: 'm1',
  capturedAtMs: 1_200_000,
  yesMidpoint: 0.55,
  noMidpoint: 0.45,
  yesSpread: 0.02,
  noSpread: 0.02,
  yesDepthTopNQuote: 500,
  noDepthTopNQuote: 600,
};

const ts = (sourceTimestampMs: number, receivedAtMs: number) => ({ sourceTimestampMs, receivedAtMs });

describe('buildFeatureSnapshot', () => {
  it('computes timeToExpiryMs', () => {
    const f = buildFeatureSnapshot({ market, clob, nowMs: 1_250_000 });
    expect(f.timeToExpiryMs).toBe(50_000);
  });

  it('computes distanceFromOpenBinancePct', () => {
    const binance: CryptoReferenceSnapshot = {
      asset: 'BTC',
      source: 'binance',
      price: 100_300,
      timestamps: ts(1_200_000, 1_200_000),
    };
    const f = buildFeatureSnapshot({ market, clob, binance, nowMs: 1_250_000 });
    expect(f.distanceFromOpenBinancePct).toBeCloseTo(0.3, 6);
  });

  it('computes binanceChainlinkDeviationPct when both feeds present', () => {
    const binance: CryptoReferenceSnapshot = {
      asset: 'BTC',
      source: 'binance',
      price: 100_300,
      timestamps: ts(1_200_000, 1_200_000),
    };
    const chainlink: CryptoReferenceSnapshot = {
      asset: 'BTC',
      source: 'chainlink',
      price: 100_000,
      timestamps: ts(1_200_000, 1_200_000),
    };
    const f = buildFeatureSnapshot({ market, clob, binance, chainlink, nowMs: 1_250_000 });
    expect(f.binanceChainlinkDeviationPct).toBeCloseTo(0.3, 6);
  });

  it('passes through CLOB midpoints, spreads and depth metrics', () => {
    const f = buildFeatureSnapshot({ market, clob, nowMs: 1_250_000 });
    expect(f.yesMidpoint).toBe(0.55);
    expect(f.noMidpoint).toBe(0.45);
    expect(f.yesSpread).toBe(0.02);
    expect(f.yesDepthMetric).toBe(500);
    expect(f.noDepthMetric).toBe(600);
  });

  it('omits feeds when missing instead of producing NaN', () => {
    const f = buildFeatureSnapshot({ market, clob, nowMs: 1_250_000 });
    expect(f.distanceFromOpenBinancePct).toBeUndefined();
    expect(f.distanceFromOpenChainlinkPct).toBeUndefined();
    expect(f.binanceChainlinkDeviationPct).toBeUndefined();
  });
});
