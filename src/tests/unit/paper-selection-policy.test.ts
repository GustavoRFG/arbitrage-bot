import { describe, expect, it } from 'vitest';

import {
  buildPolicy,
  parseSelectionMode,
  parseStrategy,
  passesPolicyThresholds,
} from '../../services/cex-paper-execution/paper-simulation-policy.js';
import { selectBestEstimate } from '../../services/cex-paper-execution/trade-selection.js';
import type { CandidateEstimateRow } from '../../services/cex-paper-execution/paper-trade-types.js';

function estimate(overrides: Partial<CandidateEstimateRow> = {}): CandidateEstimateRow {
  return {
    estimateId: 1,
    candidateId: 1,
    detectedAtMs: 1_000,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1002.5,
    avgBuyPrice: 1.0,
    avgSellPrice: 1.0025,
    feesQuote: 0.6,
    netProfitQuote: 1.9,
    netSpreadPct: 0.19,
    supportedByDepth: true,
    tradablePrefunded: true,
    ...overrides,
  };
}

describe('paper-simulation-policy', () => {
  const policy = buildPolicy({
    strategy: 'once_per_lifecycle',
    selectionMode: 'best_profit',
    minNetProfitQuote: 0.1,
    minNetSpreadPct: 0.05,
    maxTargetNotionalQuote: 1000,
  });

  it('passes the canonical eligible estimate', () => {
    expect(passesPolicyThresholds(estimate(), policy).passes).toBe(true);
  });

  it('rejects when supported_by_depth or tradable_prefunded are false', () => {
    expect(passesPolicyThresholds(estimate({ supportedByDepth: false }), policy).passes).toBe(false);
    expect(passesPolicyThresholds(estimate({ tradablePrefunded: false }), policy).passes).toBe(false);
  });

  it('enforces min net profit, min net spread, and max notional', () => {
    expect(passesPolicyThresholds(estimate({ netProfitQuote: 0.05 }), policy).passes).toBe(false);
    expect(passesPolicyThresholds(estimate({ netSpreadPct: 0.01 }), policy).passes).toBe(false);
    expect(passesPolicyThresholds(estimate({ targetNotionalQuote: 5000 }), policy).passes).toBe(false);
  });

  it('parseStrategy / parseSelectionMode normalise and reject unknown values', () => {
    expect(parseStrategy(undefined)).toBe('once_per_lifecycle');
    expect(parseStrategy('cooldown_reentry')).toBe('cooldown_reentry');
    expect(() => parseStrategy('bogus')).toThrow(/Unknown --policy/);
    expect(parseSelectionMode(undefined)).toBe('best_profit');
    expect(parseSelectionMode('largest_notional')).toBe('largest_notional');
    expect(() => parseSelectionMode('huge')).toThrow(/Unknown --selection/);
  });
});

describe('selectBestEstimate', () => {
  const policy = buildPolicy({
    strategy: 'once_per_lifecycle',
    selectionMode: 'best_profit',
    minNetProfitQuote: 0.1,
    minNetSpreadPct: 0.0,
    maxTargetNotionalQuote: 1000,
  });

  it('returns null when nothing passes thresholds', () => {
    const out = selectBestEstimate([estimate({ netProfitQuote: 0.01 })], policy);
    expect(out).toBeNull();
  });

  it('best_profit picks the estimate with the highest net profit', () => {
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 1, netProfitQuote: 0.5, targetNotionalQuote: 250 }),
        estimate({ estimateId: 2, netProfitQuote: 1.9, targetNotionalQuote: 1000 }),
        estimate({ estimateId: 3, netProfitQuote: 0.9, targetNotionalQuote: 500 }),
      ],
      policy,
    );
    expect(out?.estimateId).toBe(2);
  });

  it('largest_notional picks the biggest notional, ties broken by net profit', () => {
    const largestPolicy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'largest_notional',
      minNetProfitQuote: 0.1,
      minNetSpreadPct: 0.0,
      maxTargetNotionalQuote: 1000,
    });
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 1, targetNotionalQuote: 500, netProfitQuote: 5 }),
        estimate({ estimateId: 2, targetNotionalQuote: 1000, netProfitQuote: 1.5 }),
        estimate({ estimateId: 3, targetNotionalQuote: 1000, netProfitQuote: 1.9 }),
      ],
      largestPolicy,
    );
    expect(out?.estimateId).toBe(3);
  });

  it('best_profit is deterministic across machines (tie-breaks by spread, time, id)', () => {
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 7, netProfitQuote: 1, netSpreadPct: 0.1, detectedAtMs: 3 }),
        estimate({ estimateId: 8, netProfitQuote: 1, netSpreadPct: 0.2, detectedAtMs: 5 }),
        estimate({ estimateId: 9, netProfitQuote: 1, netSpreadPct: 0.2, detectedAtMs: 4 }),
      ],
      policy,
    );
    expect(out?.estimateId).toBe(9);
  });
});
