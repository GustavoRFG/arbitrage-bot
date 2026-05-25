import { describe, expect, it } from 'vitest';

import {
  topExecutedTrades,
  topMissedTrades,
  topRoutesByMissedPnL,
  topRoutesByPaperPnL,
  topSymbolsByInventoryEfficiency,
} from '../../services/cex-paper-execution/paper-execution-top-reports.js';

import type { MissedEntry, MissedOpportunityReport } from '../../services/cex-paper-execution/missed-opportunity-accounting.js';
import type {
  PaperArbitrageTrade,
  PaperSimulationResult,
  RejectionReason,
} from '../../services/cex-paper-execution/paper-trade-types.js';

function trade(p: Partial<PaperArbitrageTrade>): PaperArbitrageTrade {
  return {
    lifecycleId: 1,
    candidateId: 1,
    estimateId: 1,
    symbol: 'PYTH/USDT',
    buyVenue: 'binance',
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
    netProfitQuote: 1.5,
    netSpreadPct: 0.15,
    buyQuoteDelta: -1000,
    buyBaseDelta: 5000,
    sellBaseDelta: -5000,
    sellQuoteDelta: 1001,
    policyName: 'once_per_lifecycle',
    ...p,
  };
}

function emptyRej(): Record<RejectionReason, number> {
  return {
    no_eligible_estimate: 0,
    below_threshold: 0,
    latency_expired: 0,
    insufficient_quote_inventory: 0,
    insufficient_base_inventory: 0,
    lifecycle_too_short_for_latency: 0,
  };
}

function simResult(trades: PaperArbitrageTrade[]): PaperSimulationResult {
  return {
    simulationRunId: 'sim',
    sourceScannerRunId: 'r1',
    createdAtMs: 0,
    policy: {
      policyName: 'once_per_lifecycle',
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 0,
      minNetSpreadPct: 0,
      maxTargetNotionalQuote: 10_000,
    },
    latencyMs: 0,
    initialPortfolio: {},
    finalPortfolio: {},
    eligibleLifecycles: trades.length,
    trades,
    rejections: [],
    rejectionsByReason: emptyRej(),
    totalNetProfitQuote: trades.reduce((a, t) => a + t.netProfitQuote, 0),
  };
}

function missedEntry(p: Partial<MissedEntry>): MissedEntry {
  return {
    lifecycleId: 1,
    symbol: 'PYTH/USDT',
    buyVenue: 'binance',
    sellVenue: 'mexc',
    detectedAtMs: 1_000,
    reason: 'insufficient_base_inventory',
    estimatedMissedProfitQuote: 1,
    ...p,
  };
}

function missedReport(entries: MissedEntry[]): MissedOpportunityReport {
  return {
    total: entries.length,
    totalMissedProfitQuote: entries.reduce((a, e) => a + e.estimatedMissedProfitQuote, 0),
    missedByReason: emptyRej(),
    missedProfitByReason: emptyRej(),
    entries,
  };
}

describe('top reports', () => {
  it('topExecutedTrades returns trades sorted by netProfitQuote desc', () => {
    const out = topExecutedTrades(
      simResult([
        trade({ lifecycleId: 1, netProfitQuote: 1 }),
        trade({ lifecycleId: 2, netProfitQuote: 5 }),
        trade({ lifecycleId: 3, netProfitQuote: 3 }),
      ]),
      5,
    );
    expect(out.map((t) => t.lifecycleId)).toEqual([2, 3, 1]);
  });

  it('topMissedTrades returns missed entries sorted by missed profit desc', () => {
    const out = topMissedTrades(
      missedReport([
        missedEntry({ lifecycleId: 10, estimatedMissedProfitQuote: 0.5 }),
        missedEntry({ lifecycleId: 11, estimatedMissedProfitQuote: 5 }),
        missedEntry({ lifecycleId: 12, estimatedMissedProfitQuote: 1.2 }),
      ]),
      5,
    );
    expect(out.map((e) => e.lifecycleId)).toEqual([11, 12, 10]);
  });

  it('topRoutesByPaperPnL aggregates per (buy, sell) and sorts desc', () => {
    const out = topRoutesByPaperPnL([
      trade({ buyVenue: 'binance', sellVenue: 'mexc', netProfitQuote: 1.7 }),
      trade({ buyVenue: 'binance', sellVenue: 'mexc', netProfitQuote: 0.5 }),
      trade({ buyVenue: 'kucoin', sellVenue: 'mexc', netProfitQuote: 2.5 }),
    ]);
    expect(out[0]?.buyVenue).toBe('kucoin');
    expect(out[1]?.buyVenue).toBe('binance');
    expect(out[1]?.totalQuote).toBeCloseTo(2.2, 6);
  });

  it('topRoutesByMissedPnL ignores non-positive missed entries', () => {
    const out = topRoutesByMissedPnL(
      missedReport([
        missedEntry({ buyVenue: 'binance', sellVenue: 'mexc', estimatedMissedProfitQuote: 5 }),
        missedEntry({ buyVenue: 'kucoin', sellVenue: 'mexc', estimatedMissedProfitQuote: 0 }),
        missedEntry({ buyVenue: 'gateio', sellVenue: 'mexc', estimatedMissedProfitQuote: 2 }),
      ]),
    );
    expect(out.length).toBe(2);
    expect(out[0]?.buyVenue).toBe('binance');
  });

  it('topSymbolsByInventoryEfficiency computes profit per base unit', () => {
    const out = topSymbolsByInventoryEfficiency([
      trade({ symbol: 'PYTH/USDT', netProfitQuote: 1, baseQty: 1000 }), // 0.001
      trade({ symbol: 'INJ/USDT', netProfitQuote: 2, baseQty: 200 }), // 0.01   (wins)
      trade({ symbol: 'INJ/USDT', netProfitQuote: 0.5, baseQty: 100 }), // 0.005 (still INJ ahead)
    ]);
    expect(out[0]?.symbol).toBe('INJ/USDT');
    expect(out[0]?.profitPerBase).toBeCloseTo(2.5 / 300, 6);
    expect(out[1]?.symbol).toBe('PYTH/USDT');
  });
});
