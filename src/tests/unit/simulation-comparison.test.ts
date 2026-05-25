import { describe, expect, it } from 'vitest';

import { FeeResolver } from '../../services/cex-arbitrage/fee-resolver.js';
import { ComparisonReportService } from '../../services/cex-paper-execution/comparison-report-service.js';
import { PRESETS } from '../../services/cex-paper-execution/inventory-presets.js';
import { buildPolicy } from '../../services/cex-paper-execution/paper-simulation-policy.js';
import { runComparison } from '../../services/cex-paper-execution/simulation-comparison.js';
import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function est(p: Partial<CandidateEstimateRow>): CandidateEstimateRow {
  return {
    estimateId: 1,
    candidateId: 1,
    detectedAtMs: 1_000,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1010,
    avgBuyPrice: 0.2,
    avgSellPrice: 0.202,
    feesQuote: 1,
    netProfitQuote: 5,
    netSpreadPct: 0.5,
    supportedByDepth: true,
    tradablePrefunded: true,
    ...p,
  };
}

function lc(id: number, buy: string, sell: string, e: CandidateEstimateRow): LifecycleWithEstimates {
  return {
    lifecycleId: id,
    symbol: 'PYTH/USDT',
    buyVenue: buy,
    sellVenue: sell,
    firstSeenAtMs: e.detectedAtMs,
    lastSeenAtMs: e.detectedAtMs + 5_000,
    endedAtMs: e.detectedAtMs + 5_000,
    durationMs: 5_000,
    observationCount: 1,
    estimates: [e],
  };
}

describe('simulation-comparison', () => {
  it('runs the cross-product of presets × latencies and emits one cell each', () => {
    const lcs = [
      lc(1, 'binance', 'mexc', est({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 5 })),
      lc(2, 'kucoin', 'mexc', est({ estimateId: 11, detectedAtMs: 1_500, netProfitQuote: 9 })),
    ];
    const report = runComparison({
      sourceScannerRunId: 'r1',
      policy: buildPolicy({
        strategy: 'once_per_lifecycle',
        selectionMode: 'best_profit',
        minNetProfitQuote: 0,
        minNetSpreadPct: 0,
        maxTargetNotionalQuote: 10_000,
      }),
      latenciesMs: [0, 3_000],
      presets: [PRESETS.conservative, PRESETS.moderate],
      lifecycles: lcs,
      feeResolver: new FeeResolver(),
      createdAtMs: 0,
      contentionMode: 'single_route',
      simulationRunIdPrefix: 'cmp',
    });
    expect(report.cells.length).toBe(4); // 2 presets × 2 latencies
    for (const cell of report.cells) {
      expect(cell.simulationRunId.startsWith('cmp_')).toBe(true);
      expect(cell.missed.totalMissedProfitQuote).toBeGreaterThanOrEqual(0);
    }
  });

  it('multi-route contention with tight inventory drops the lower-priority trade', () => {
    // Conservative preset seeds 1000 USDT on each buy venue and 1000/0.2 =
    // 5000 PYTH on MEXC. Each trade here is 800 notional (fee + buy fits in
    // 1000 USDT) and consumes 800/0.2 = 4000 PYTH on the sell side, so the
    // first trade succeeds (5000 - 4000 = 1000 left) and the second is
    // rejected as insufficient_base_inventory.
    const small = (overrides: Partial<CandidateEstimateRow>): CandidateEstimateRow =>
      est({
        targetNotionalQuote: 800,
        executableBuyNotional: 800,
        executableSellNotional: 808,
        ...overrides,
      });
    const lcs = [
      lc(1, 'binance', 'mexc', small({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 4 })),
      lc(2, 'kucoin', 'mexc', small({ estimateId: 11, detectedAtMs: 1_500, netProfitQuote: 9 })),
    ];
    const report = runComparison({
      sourceScannerRunId: 'r1',
      policy: buildPolicy({
        strategy: 'once_per_lifecycle',
        selectionMode: 'best_profit',
        minNetProfitQuote: 0,
        minNetSpreadPct: 0,
        maxTargetNotionalQuote: 10_000,
      }),
      latenciesMs: [0],
      presets: [PRESETS.conservative],
      lifecycles: lcs,
      feeResolver: new FeeResolver(),
      createdAtMs: 0,
      contentionMode: 'multi_route',
      simulationRunIdPrefix: 'cmp',
    });
    const cell = report.cells[0]!;
    expect(cell.executedTrades).toBe(1);
    // The 9 USDT trade should beat the 4 USDT trade under best_profit.
    expect(cell.topExecuted[0]?.netProfitQuote).toBe(9);
    expect(cell.rejectionsByReason.insufficient_base_inventory).toBe(1);
    expect(cell.missed.totalMissedProfitQuote).toBeGreaterThan(0);
  });

  it('format renders all required sections and per-cell details', () => {
    const lcs = [
      lc(1, 'binance', 'mexc', est({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 5 })),
    ];
    const report = runComparison({
      sourceScannerRunId: 'r1',
      policy: buildPolicy({
        strategy: 'once_per_lifecycle',
        selectionMode: 'best_profit',
        minNetProfitQuote: 0,
        minNetSpreadPct: 0,
        maxTargetNotionalQuote: 10_000,
      }),
      latenciesMs: [0],
      presets: [PRESETS.moderate],
      lifecycles: lcs,
      feeResolver: new FeeResolver(),
      createdAtMs: 0,
      contentionMode: 'single_route',
      simulationRunIdPrefix: 'cmp',
    });
    const text = new ComparisonReportService().format(report);
    expect(text).toContain('INVENTORY/LATENCY COMPARISON');
    expect(text).toContain('PnL by preset × latency');
    expect(text).toContain('Rejections by reason');
    expect(text).toContain('Missed PnL by reason');
    expect(text).toContain('Top executed trades');
    expect(text).toContain('Top missed trades');
    expect(text).toContain('Top routes by paper PnL');
    expect(text).toContain('Top routes by missed PnL');
    expect(text).toContain('Top symbols by inventory efficiency');
    expect(text).toContain('Final inventory drift');
  });
});
