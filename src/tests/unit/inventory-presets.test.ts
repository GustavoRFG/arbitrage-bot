import { describe, expect, it } from 'vitest';

import {
  PRESETS,
  buildPresetPortfolio,
  parsePresetName,
  presetByName,
} from '../../services/cex-paper-execution/inventory-presets.js';
import type { LifecycleWithEstimates } from '../../services/cex-paper-execution/paper-trade-types.js';

function lc(
  id: number,
  symbol: string,
  buy: string,
  sell: string,
  avgBuyPrice: number,
): LifecycleWithEstimates {
  return {
    lifecycleId: id,
    symbol,
    buyVenue: buy,
    sellVenue: sell,
    firstSeenAtMs: 1,
    lastSeenAtMs: 1000,
    endedAtMs: null,
    durationMs: 999,
    observationCount: 1,
    estimates: [
      {
        estimateId: id,
        candidateId: id,
        detectedAtMs: 1,
        targetNotionalQuote: 500,
        executableBuyNotional: 500,
        executableSellNotional: 510,
        avgBuyPrice,
        avgSellPrice: avgBuyPrice * 1.02,
        feesQuote: 0.3,
        netProfitQuote: 1,
        netSpreadPct: 0.2,
        supportedByDepth: true,
        tradablePrefunded: true,
      },
    ],
  };
}

describe('inventory-presets', () => {
  it('parsePresetName accepts the four canonical names and rejects others', () => {
    expect(parsePresetName(undefined)).toBe('moderate');
    expect(parsePresetName('conservative')).toBe('conservative');
    expect(parsePresetName('AGGRESSIVE')).toBe('aggressive');
    expect(parsePresetName('custom')).toBe('custom');
    expect(() => parsePresetName('huge')).toThrow(/Unknown --preset/);
  });

  it('presetByName returns the documented funding numbers', () => {
    expect(presetByName('conservative').quotePerBuyVenue).toBe(1_000);
    expect(presetByName('moderate').quotePerBuyVenue).toBe(5_000);
    expect(presetByName('aggressive').quotePerBuyVenue).toBe(50_000);
    expect(PRESETS.conservative.baseNotionalPerSellVenue).toBe(1_000);
  });

  it('buildPresetPortfolio fans out per (venue, asset) for the lifecycle set', () => {
    const lcs = [
      lc(1, 'PYTH/USDT', 'binance', 'mexc', 0.2),
      lc(2, 'PYTH/USDT', 'kucoin', 'mexc', 0.2),
      lc(3, 'INJ/USDT', 'bitget', 'gateio', 20),
    ];
    const portfolio = buildPresetPortfolio(presetByName('conservative'), lcs);

    // Quote seeded on every buy venue.
    expect(portfolio.binance?.USDT).toBe(1_000);
    expect(portfolio.kucoin?.USDT).toBe(1_000);
    expect(portfolio.bitget?.USDT).toBe(1_000);
    // PYTH base seeded on the sell venue at 1000/0.2 = 5000 PYTH; only one
    // entry even though two lifecycles seed it (max wins, not sum).
    expect(portfolio.mexc?.PYTH).toBeCloseTo(5_000, 6);
    expect(portfolio.gateio?.INJ).toBeCloseTo(50, 6);
  });

  it('custom preset returns the caller-provided portfolio (deep copy)', () => {
    const provided = { mexc: { PYTH: 1_234_567 } };
    const out = buildPresetPortfolio(
      { name: 'custom', label: 'pinned', portfolio: provided },
      [],
    );
    expect(out.mexc?.PYTH).toBe(1_234_567);
    // Mutation of the returned portfolio should not affect the caller.
    out.mexc!.PYTH = 0;
    expect(provided.mexc.PYTH).toBe(1_234_567);
  });
});
