import { describe, expect, it } from 'vitest';

import { FeeResolver } from '../../services/cex-arbitrage/fee-resolver.js';
import { MultiRouteContentionSimulator } from '../../services/cex-paper-execution/multi-route-contention-simulator.js';
import { buildPolicy } from '../../services/cex-paper-execution/paper-simulation-policy.js';
import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
  PaperPortfolioJson,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function est(p: Partial<CandidateEstimateRow>): CandidateEstimateRow {
  return {
    estimateId: 1,
    candidateId: 1,
    detectedAtMs: 1_000,
    targetNotionalQuote: 1000,
    executableBuyNotional: 1000,
    executableSellNotional: 1010,
    avgBuyPrice: 1,
    avgSellPrice: 1.01,
    feesQuote: 1,
    netProfitQuote: 9,
    netSpreadPct: 0.5,
    supportedByDepth: true,
    tradablePrefunded: true,
    ...p,
  };
}

function lifecycle(id: number, buy: string, sell: string, e: CandidateEstimateRow): LifecycleWithEstimates {
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

const feeResolver = new FeeResolver();

describe('MultiRouteContentionSimulator', () => {
  it('shares one sell-venue base pool across competing buy venues', () => {
    // Three competing buy venues all want to sell 1000 PYTH on MEXC.
    // MEXC has only 1500 PYTH — only one full trade fits, plus partial?
    // No: trades are all-or-nothing in this simulator, so exactly one
    // succeeds and the other two are rejected as
    // insufficient_base_inventory.
    const lcs = [
      lifecycle(1, 'binance', 'mexc', est({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 5 })),
      lifecycle(2, 'kucoin', 'mexc', est({ estimateId: 11, detectedAtMs: 1_500, netProfitQuote: 9 })),
      lifecycle(3, 'gateio', 'mexc', est({ estimateId: 12, detectedAtMs: 2_000, netProfitQuote: 3 })),
    ];
    const initialPortfolio: PaperPortfolioJson = {
      binance: { USDT: 1_000_000 },
      kucoin: { USDT: 1_000_000 },
      gateio: { USDT: 1_000_000 },
      mexc: { PYTH: 1_500 },
    };

    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 1,
      minNetSpreadPct: 0,
      maxTargetNotionalQuote: 10_000,
    });

    const result = new MultiRouteContentionSimulator({
      simulationRunId: 'sim',
      sourceScannerRunId: 'r1',
      policy,
      latencyMs: 0,
      lifecycles: lcs,
      initialPortfolio,
      feeResolver,
      createdAtMs: 0,
    }).run();

    // Highest profit wins under best_profit -> kucoin (9 USDT).
    expect(result.trades.length).toBe(1);
    expect(result.trades[0]?.buyVenue).toBe('kucoin');
    expect(result.rejections.length).toBe(2);
    expect(result.rejectionsByReason.insufficient_base_inventory).toBe(2);
    // The losers must include both binance and gateio.
    const losers = result.rejections.map((r) => r.buyVenue).sort();
    expect(losers).toEqual(['binance', 'gateio']);
  });

  it('fifo priority lets earliest detected estimate consume inventory first', () => {
    const lcs = [
      lifecycle(1, 'binance', 'mexc', est({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 1 })),
      lifecycle(2, 'kucoin', 'mexc', est({ estimateId: 11, detectedAtMs: 1_500, netProfitQuote: 9 })),
    ];
    const initialPortfolio: PaperPortfolioJson = {
      binance: { USDT: 1_000_000 },
      kucoin: { USDT: 1_000_000 },
      mexc: { PYTH: 1_500 },
    };
    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'fifo',
      minNetProfitQuote: 0.5,
      minNetSpreadPct: 0,
      maxTargetNotionalQuote: 10_000,
    });

    const result = new MultiRouteContentionSimulator({
      simulationRunId: 'sim',
      sourceScannerRunId: 'r1',
      policy,
      latencyMs: 0,
      lifecycles: lcs,
      initialPortfolio,
      feeResolver,
      createdAtMs: 0,
    }).run();

    expect(result.trades.length).toBe(1);
    expect(result.trades[0]?.buyVenue).toBe('binance');
    expect(result.rejectionsByReason.insufficient_base_inventory).toBe(1);
  });

  it('multiple trades fit when the shared pool covers them', () => {
    const lcs = [
      lifecycle(1, 'binance', 'mexc', est({ estimateId: 10, detectedAtMs: 1_000, netProfitQuote: 5 })),
      lifecycle(2, 'kucoin', 'mexc', est({ estimateId: 11, detectedAtMs: 2_000, netProfitQuote: 4 })),
    ];
    const initialPortfolio: PaperPortfolioJson = {
      binance: { USDT: 1_000_000 },
      kucoin: { USDT: 1_000_000 },
      mexc: { PYTH: 10_000 },
    };
    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 1,
      minNetSpreadPct: 0,
      maxTargetNotionalQuote: 10_000,
    });
    const result = new MultiRouteContentionSimulator({
      simulationRunId: 'sim',
      sourceScannerRunId: 'r1',
      policy,
      latencyMs: 0,
      lifecycles: lcs,
      initialPortfolio,
      feeResolver,
      createdAtMs: 0,
    }).run();
    expect(result.trades.length).toBe(2);
    expect(result.rejections.length).toBe(0);
  });
});
