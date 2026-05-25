import { describe, expect, it } from 'vitest';

import { PaperExecutionReportService } from '../../services/cex-paper-execution/paper-execution-report-service.js';
import type {
  PaperArbitrageTrade,
  PaperSimulationResult,
  RejectionReason,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function emptyRejections(): Record<RejectionReason, number> {
  return {
    no_eligible_estimate: 0,
    below_threshold: 0,
    latency_expired: 0,
    insufficient_quote_inventory: 0,
    insufficient_base_inventory: 0,
    lifecycle_too_short_for_latency: 0,
  };
}

function trade(overrides: Partial<PaperArbitrageTrade>): PaperArbitrageTrade {
  return {
    lifecycleId: 1,
    candidateId: 1,
    estimateId: 1,
    symbol: 'PYTH/USDT',
    buyVenue: 'bitget',
    sellVenue: 'mexc',
    detectedAtMs: 1_000,
    executedAtMs: 1_000,
    latencyMs: 0,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1002,
    baseQty: 5000,
    avgBuyPrice: 0.2,
    avgSellPrice: 0.2004,
    feesQuote: 0.3,
    netProfitQuote: 1.74,
    netSpreadPct: 0.174,
    buyQuoteDelta: -1000.5,
    buyBaseDelta: 5000,
    sellBaseDelta: -5000,
    sellQuoteDelta: 1001.5,
    policyName: 'once_per_lifecycle',
    ...overrides,
  };
}

function simulationResult(overrides: Partial<PaperSimulationResult>): PaperSimulationResult {
  return {
    simulationRunId: 'sim-1',
    sourceScannerRunId: 'r1',
    createdAtMs: 1,
    policy: {
      policyName: 'once_per_lifecycle',
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 0.1,
      minNetSpreadPct: 0.03,
      maxTargetNotionalQuote: 1000,
    },
    latencyMs: 0,
    initialPortfolio: { bitget: { USDT: 5000 }, mexc: { PYTH: 10000 } },
    finalPortfolio: { bitget: { USDT: 4000 }, mexc: { PYTH: 5000, USDT: 1001.5 } },
    eligibleLifecycles: 1,
    trades: [],
    rejections: [],
    rejectionsByReason: emptyRejections(),
    totalNetProfitQuote: 0,
    ...overrides,
  };
}

describe('PaperExecutionReportService', () => {
  it('aggregates PnL by route and by symbol, derives drift, and finds best trade', () => {
    const trades: PaperArbitrageTrade[] = [
      trade({ netProfitQuote: 1.74, buyVenue: 'bitget', sellVenue: 'mexc', symbol: 'PYTH/USDT' }),
      trade({ netProfitQuote: 1.49, buyVenue: 'kucoin', sellVenue: 'mexc', symbol: 'PYTH/USDT' }),
      trade({ netProfitQuote: 0.45, buyVenue: 'bitget', sellVenue: 'mexc', symbol: 'INJ/USDT' }),
    ];
    const result = simulationResult({
      trades,
      totalNetProfitQuote: trades.reduce((a, t) => a + t.netProfitQuote, 0),
    });
    const scenario = new PaperExecutionReportService().build(result);
    expect(scenario.executedTrades).toBe(3);
    expect(scenario.totalNetProfitQuote).toBeCloseTo(3.68, 2);
    expect(scenario.avgNetProfitQuote).toBeCloseTo(3.68 / 3, 6);
    expect(scenario.medianNetProfitQuote).toBeCloseTo(1.49, 6);

    const top = scenario.topByRoute;
    expect(top[0]?.buyVenue).toBe('bitget');
    expect(top[0]?.sellVenue).toBe('mexc');
    expect(top[0]?.trades).toBe(2);
    expect(top[0]?.totalNetProfitQuote).toBeCloseTo(2.19, 6);

    const bySymbol = scenario.topBySymbol;
    expect(bySymbol[0]?.symbol).toBe('PYTH/USDT');
    expect(bySymbol[0]?.totalNetProfitQuote).toBeCloseTo(3.23, 6);

    expect(scenario.bestTrade?.symbol).toBe('PYTH/USDT');
    expect(scenario.bestTrade?.netProfitQuote).toBeCloseTo(1.74, 6);

    expect(scenario.drift.bitget?.USDT).toBe(-1000);
    expect(scenario.drift.mexc?.PYTH).toBe(-5000);
    expect(scenario.drift.mexc?.USDT).toBeCloseTo(1001.5, 6);
  });

  it('format prints a multi-latency analytical report', () => {
    const reporter = new PaperExecutionReportService();
    const s1 = reporter.build(
      simulationResult({
        latencyMs: 0,
        trades: [trade({ netProfitQuote: 1.74 })],
        totalNetProfitQuote: 1.74,
      }),
    );
    const s2 = reporter.build(
      simulationResult({
        latencyMs: 3000,
        trades: [],
        totalNetProfitQuote: 0,
        rejectionsByReason: { ...emptyRejections(), latency_expired: 1 },
      }),
    );
    const out = reporter.format([s1, s2], {
      sourceScannerRunId: 'r1',
      policyName: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      latenciesMs: [0, 3000],
      minProfitQuote: 0.1,
      minSpreadPct: 0.03,
      maxNotionalQuote: 1000,
    });
    expect(out).toContain('CEX PREFUNDED PAPER EXECUTION — REPORT');
    expect(out).toContain('PnL by latency');
    expect(out).toContain('Executed trades @ 0ms');
    expect(out).toContain('Executed trades @ 3000ms');
    expect(out).toContain('latency expired:                1');
    expect(out).toContain('+1.74 USDT');
  });
});
