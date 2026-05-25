import { describe, expect, it } from 'vitest';

import { buildPolicy, parseSelectionMode } from '../../services/cex-paper-execution/paper-simulation-policy.js';
import { efficiency, selectBestEstimate } from '../../services/cex-paper-execution/trade-selection.js';
import type { CandidateEstimateRow, SelectionMode } from '../../services/cex-paper-execution/paper-trade-types.js';

function estimate(overrides: Partial<CandidateEstimateRow> = {}): CandidateEstimateRow {
  return {
    estimateId: 1,
    candidateId: 1,
    detectedAtMs: 1_000,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1002,
    avgBuyPrice: 1.0,
    avgSellPrice: 1.002,
    feesQuote: 0.3,
    netProfitQuote: 1.7,
    netSpreadPct: 0.17,
    supportedByDepth: true,
    tradablePrefunded: true,
    ...overrides,
  };
}

const policyFor = (mode: SelectionMode) =>
  buildPolicy({
    strategy: 'once_per_lifecycle',
    selectionMode: mode,
    minNetProfitQuote: 0,
    minNetSpreadPct: 0,
    maxTargetNotionalQuote: 10_000,
  });

describe('extended selection policies', () => {
  it('parseSelectionMode accepts all four new modes', () => {
    expect(parseSelectionMode('fifo')).toBe('fifo');
    expect(parseSelectionMode('best_profit_first')).toBe('best_profit_first');
    expect(parseSelectionMode('best_spread_first')).toBe('best_spread_first');
    expect(parseSelectionMode('inventory_efficiency')).toBe('inventory_efficiency');
  });

  it('FIFO picks the earliest detected estimate, tie-break by id', () => {
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 3, detectedAtMs: 200, netProfitQuote: 5 }),
        estimate({ estimateId: 1, detectedAtMs: 100, netProfitQuote: 1 }),
        estimate({ estimateId: 2, detectedAtMs: 100, netProfitQuote: 1 }),
      ],
      policyFor('fifo'),
    );
    expect(out?.estimateId).toBe(1);
  });

  it('best_profit_first behaves like best_profit', () => {
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 1, netProfitQuote: 0.5 }),
        estimate({ estimateId: 2, netProfitQuote: 1.9 }),
      ],
      policyFor('best_profit_first'),
    );
    expect(out?.estimateId).toBe(2);
  });

  it('best_spread_first picks the highest net spread, ties broken by profit', () => {
    const out = selectBestEstimate(
      [
        estimate({ estimateId: 1, netSpreadPct: 0.1, netProfitQuote: 5 }),
        estimate({ estimateId: 2, netSpreadPct: 0.5, netProfitQuote: 0.5 }),
        estimate({ estimateId: 3, netSpreadPct: 0.5, netProfitQuote: 0.9 }),
      ],
      policyFor('best_spread_first'),
    );
    expect(out?.estimateId).toBe(3);
  });

  it('inventory_efficiency picks the estimate with the highest profit per base unit', () => {
    // baseQty = executableBuyNotional / avgBuyPrice.
    // e1: 1000 / 0.5 = 2000 base, profit 1 -> 0.0005 / base
    // e2: 1000 / 2 = 500 base,  profit 1 -> 0.002  / base  (wins)
    const e1 = estimate({ estimateId: 1, avgBuyPrice: 0.5, netProfitQuote: 1 });
    const e2 = estimate({ estimateId: 2, avgBuyPrice: 2, netProfitQuote: 1 });
    const out = selectBestEstimate([e1, e2], policyFor('inventory_efficiency'));
    expect(out?.estimateId).toBe(2);
    expect(efficiency(e2)).toBeGreaterThan(efficiency(e1));
  });

  it('efficiency is safe for degenerate avgBuyPrice', () => {
    expect(efficiency(estimate({ avgBuyPrice: 0 }))).toBe(0);
    expect(efficiency(estimate({ avgBuyPrice: Number.NaN }))).toBe(0);
  });
});
