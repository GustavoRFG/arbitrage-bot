import { describe, expect, it } from 'vitest';

import {
  buildMissedOpportunityReport,
  estimateMissedProfit,
} from '../../services/cex-paper-execution/missed-opportunity-accounting.js';
import { buildPolicy } from '../../services/cex-paper-execution/paper-simulation-policy.js';
import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
  PaperTradeRejection,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function est(p: Partial<CandidateEstimateRow> = {}): CandidateEstimateRow {
  return {
    estimateId: 1,
    candidateId: 1,
    detectedAtMs: 1_000,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1002,
    avgBuyPrice: 1,
    avgSellPrice: 1.002,
    feesQuote: 0.3,
    netProfitQuote: 1.7,
    netSpreadPct: 0.17,
    supportedByDepth: true,
    tradablePrefunded: true,
    ...p,
  };
}

function lc(id: number, estimates: CandidateEstimateRow[]): LifecycleWithEstimates {
  return {
    lifecycleId: id,
    symbol: 'PYTH/USDT',
    buyVenue: 'binance',
    sellVenue: 'mexc',
    firstSeenAtMs: 1,
    lastSeenAtMs: 5_000,
    endedAtMs: 5_000,
    durationMs: 4_999,
    observationCount: estimates.length,
    estimates,
  };
}

const policy = buildPolicy({
  strategy: 'once_per_lifecycle',
  selectionMode: 'best_profit',
  minNetProfitQuote: 1,
  minNetSpreadPct: 0,
  maxTargetNotionalQuote: 10_000,
});

describe('missed-opportunity-accounting', () => {
  it('zero missed profit for no_eligible_estimate or empty lifecycle', () => {
    expect(estimateMissedProfit(lc(1, []), 'no_eligible_estimate', policy)).toBe(0);
    expect(estimateMissedProfit(lc(1, [est()]), 'no_eligible_estimate', policy)).toBe(0);
  });

  it('latency-based reasons use the best net profit across the lifecycle', () => {
    const lifecycle = lc(2, [
      est({ estimateId: 1, netProfitQuote: 0.5 }),
      est({ estimateId: 2, netProfitQuote: 4.2 }),
    ]);
    expect(estimateMissedProfit(lifecycle, 'latency_expired', policy)).toBe(4.2);
    expect(estimateMissedProfit(lifecycle, 'lifecycle_too_short_for_latency', policy)).toBe(4.2);
  });

  it('inventory rejections take the best policy-passing profit', () => {
    const lifecycle = lc(3, [
      est({ estimateId: 1, netProfitQuote: 0.5 }), // below min profit
      est({ estimateId: 2, netProfitQuote: 4.2 }),
      est({ estimateId: 3, netProfitQuote: 0.9 }), // below
    ]);
    expect(estimateMissedProfit(lifecycle, 'insufficient_quote_inventory', policy)).toBe(4.2);
    expect(estimateMissedProfit(lifecycle, 'insufficient_base_inventory', policy)).toBe(4.2);
  });

  it('below_threshold uses the max profit even when none pass policy', () => {
    const lifecycle = lc(4, [
      est({ estimateId: 1, netProfitQuote: 0.5 }),
      est({ estimateId: 2, netProfitQuote: 0.9 }),
    ]);
    expect(estimateMissedProfit(lifecycle, 'below_threshold', policy)).toBe(0.9);
  });

  it('negative best profit is coerced to zero', () => {
    const lifecycle = lc(5, [est({ estimateId: 1, netProfitQuote: -3 })]);
    expect(estimateMissedProfit(lifecycle, 'latency_expired', policy)).toBe(0);
  });

  it('buildMissedOpportunityReport tallies per reason and total', () => {
    const lcA = lc(10, [est({ estimateId: 1, netProfitQuote: 2 })]);
    const lcB = lc(11, [est({ estimateId: 2, netProfitQuote: 3 })]);
    const lcC = lc(12, [est({ estimateId: 3, netProfitQuote: 1.5 })]);
    const rejections: PaperTradeRejection[] = [
      {
        lifecycleId: 10,
        symbol: 'PYTH/USDT',
        buyVenue: 'binance',
        sellVenue: 'mexc',
        detectedAtMs: 1_000,
        reason: 'insufficient_base_inventory',
      },
      {
        lifecycleId: 11,
        symbol: 'PYTH/USDT',
        buyVenue: 'kucoin',
        sellVenue: 'mexc',
        detectedAtMs: 1_500,
        reason: 'latency_expired',
      },
      {
        lifecycleId: 12,
        symbol: 'PYTH/USDT',
        buyVenue: 'gateio',
        sellVenue: 'mexc',
        detectedAtMs: 2_000,
        reason: 'insufficient_quote_inventory',
      },
    ];
    const out = buildMissedOpportunityReport(rejections, [lcA, lcB, lcC], policy);
    expect(out.total).toBe(3);
    expect(out.missedByReason.insufficient_base_inventory).toBe(1);
    expect(out.missedByReason.latency_expired).toBe(1);
    expect(out.missedByReason.insufficient_quote_inventory).toBe(1);
    expect(out.missedProfitByReason.insufficient_base_inventory).toBe(2);
    expect(out.missedProfitByReason.latency_expired).toBe(3);
    expect(out.missedProfitByReason.insufficient_quote_inventory).toBe(1.5);
    expect(out.totalMissedProfitQuote).toBeCloseTo(6.5, 6);
    expect(out.entries.length).toBe(3);
  });
});
