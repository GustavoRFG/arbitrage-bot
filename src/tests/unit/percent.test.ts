import { describe, expect, it } from 'vitest';

import {
  approxNetSpreadPct,
  grossSpreadPct,
  pctChange,
  rateToPct,
} from '../../core/math/percent.js';

describe('percent helpers', () => {
  it('grossSpreadPct returns positive when sell > buy', () => {
    expect(grossSpreadPct(100, 101)).toBeCloseTo(1.0, 6);
  });

  it('grossSpreadPct returns negative when buy > sell', () => {
    expect(grossSpreadPct(101, 100)).toBeCloseTo(-0.990099, 5);
  });

  it('grossSpreadPct returns 0 for identical prices', () => {
    expect(grossSpreadPct(100, 100)).toBe(0);
  });

  it('grossSpreadPct guards against zero/negative buy price', () => {
    expect(grossSpreadPct(0, 100)).toBe(0);
    expect(grossSpreadPct(-1, 100)).toBe(0);
  });

  it('approxNetSpreadPct subtracts both fees correctly', () => {
    // gross = 1%, fees = 0.1% + 0.2% -> approx = 0.7%
    expect(approxNetSpreadPct(100, 101, 0.001, 0.002)).toBeCloseTo(0.7, 6);
  });

  it('approxNetSpreadPct can produce negative net for tight spreads', () => {
    expect(approxNetSpreadPct(100, 100.1, 0.001, 0.002)).toBeLessThan(0);
  });

  it('rateToPct converts decimals', () => {
    expect(rateToPct(0.001)).toBe(0.1);
  });

  it('pctChange handles zero base', () => {
    expect(pctChange(0, 100)).toBe(0);
  });
});
