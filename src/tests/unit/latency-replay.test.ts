import { describe, expect, it } from 'vitest';

import { replayWithLatency } from '../../services/cex-paper-execution/latency-replay.js';
import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function est(
  estimateId: number,
  detectedAtMs: number,
  netProfitQuote = 1.5,
): CandidateEstimateRow {
  return {
    estimateId,
    candidateId: estimateId,
    detectedAtMs,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1002.5,
    avgBuyPrice: 1.0,
    avgSellPrice: 1.0025,
    feesQuote: 0.5,
    netProfitQuote,
    netSpreadPct: 0.15,
    supportedByDepth: true,
    tradablePrefunded: true,
  };
}

function lifecycle(
  estimates: CandidateEstimateRow[],
  overrides: Partial<LifecycleWithEstimates> = {},
): LifecycleWithEstimates {
  const firstSeen = estimates[0]?.detectedAtMs ?? 0;
  const lastSeen = estimates.at(-1)?.detectedAtMs ?? firstSeen;
  return {
    lifecycleId: 42,
    symbol: 'PYTH/USDT',
    buyVenue: 'bitget',
    sellVenue: 'mexc',
    firstSeenAtMs: firstSeen,
    lastSeenAtMs: lastSeen,
    endedAtMs: lastSeen,
    durationMs: lastSeen - firstSeen,
    observationCount: estimates.length,
    estimates,
    ...overrides,
  };
}

describe('replayWithLatency', () => {
  it('latency=0 keeps every estimate and executes at the earliest detected_at', () => {
    const lc = lifecycle([est(1, 1_000), est(2, 2_000), est(3, 3_000)]);
    const result = replayWithLatency(lc, 0);
    expect(result.survivingEstimates).toHaveLength(3);
    expect(result.executedAtMs).toBe(1_000);
    expect(result.expiredBeforeLatency).toBe(false);
  });

  it('rejects with expiredBeforeLatency when no estimate survives the latency window', () => {
    const lc = lifecycle([est(1, 1_000), est(2, 1_500)]);
    const result = replayWithLatency(lc, 5_000);
    expect(result.survivingEstimates).toHaveLength(0);
    expect(result.expiredBeforeLatency).toBe(true);
    expect(result.executedAtMs).toBeUndefined();
  });

  it('drops every estimate with detected_at strictly before firstSeen+L', () => {
    // firstSeen=1_000, L=3_000 → threshold=4_000.
    // Estimates at 1_000 and 3_500 are dropped (the trader has not reacted yet);
    // the 6_000 estimate is the first that survives.
    const lc = lifecycle([
      est(1, 1_000, 0.2),
      est(2, 3_500, 1.8),
      est(3, 6_000, 0.9),
    ]);
    const result = replayWithLatency(lc, 3_000);
    expect(result.survivingEstimates.map((e) => e.estimateId)).toEqual([3]);
    expect(result.executedAtMs).toBe(6_000);
    expect(result.expiredBeforeLatency).toBe(false);
  });

  it('survives when an estimate lands exactly at firstSeen+L', () => {
    const lc = lifecycle([est(1, 1_000), est(2, 4_000)]);
    const result = replayWithLatency(lc, 3_000);
    expect(result.survivingEstimates.map((e) => e.estimateId)).toEqual([2]);
    expect(result.executedAtMs).toBe(4_000);
  });

  it('treats an empty lifecycle as expired', () => {
    const lc = lifecycle([]);
    const result = replayWithLatency(lc, 0);
    expect(result.expiredBeforeLatency).toBe(true);
  });
});
