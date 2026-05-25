import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDbAt } from '../../persistence/db.js';
import { ArbitrageLifecycleRepository } from '../../persistence/repositories/arbitrage-lifecycle-repository.js';
import { ArbitrageRepository } from '../../persistence/repositories/arbitrage-repository.js';
import { PaperSimulationRepository } from '../../persistence/repositories/paper-simulation-repository.js';
import { ScannerRunRepository } from '../../persistence/repositories/scanner-run-repository.js';
import { FeeResolver } from '../../services/cex-arbitrage/fee-resolver.js';
import { CandidateReplayLoader } from '../../services/cex-paper-execution/candidate-replay-loader.js';
import { buildPolicy } from '../../services/cex-paper-execution/paper-simulation-policy.js';
import {
  buildAutoPrefundedPortfolio,
  PaperSimulator,
} from '../../services/cex-paper-execution/paper-simulator.js';

let workdir: string;
let dbPath: string;

beforeEach(() => {
  workdir = join(tmpdir(), `paper-cex-tests-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workdir, { recursive: true });
  dbPath = join(workdir, 'observatory.sqlite');
});

afterEach(() => {
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

function scannerRun(runId: string) {
  return {
    runId,
    mode: 'cex' as const,
    startedAtMs: 1,
    endedAtMs: 1_000_000,
    configHash: 'h',
    status: 'completed' as const,
    totalCycles: 1,
    totalSymbolsScanned: 1,
    totalCandidates: 0,
    totalMaterialCandidates: 0,
    actualElapsedMs: 999_999,
  };
}

interface Seed {
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  observations: Array<{
    detectedAtMs: number;
    estimates: Array<{
      targetNotionalQuote: number;
      executableBuyNotional: number;
      executableSellNotional: number;
      avgBuyPrice: number;
      avgSellPrice: number;
      feesQuote: number;
      netProfitQuote: number;
      netSpreadPct: number;
      tradablePrefunded?: boolean;
      supportedByDepth?: boolean;
    }>;
  }>;
}

function seedLifecycle(runId: string, seed: Seed) {
  const db = openDbAt(dbPath);
  const lifecycles = new ArbitrageLifecycleRepository(db);
  const arbitrage = new ArbitrageRepository(db);
  const eventKey = `cex:${seed.symbol}:${seed.buyVenue}:${seed.sellVenue}`;

  let lifecycleId = 0;
  for (const obs of seed.observations) {
    lifecycleId = lifecycles.upsertOpen({
      runId,
      eventKey,
      symbol: seed.symbol,
      buyExchange: seed.buyVenue,
      sellExchange: seed.sellVenue,
      observedAtMs: obs.detectedAtMs,
      grossSpreadPct: 0.5,
      approxNetSpreadPct: 0.3,
      netProfitQuote: Math.max(0, ...obs.estimates.map((e) => e.netProfitQuote)),
      supportedNotionalQuote: Math.max(...obs.estimates.map((e) => e.targetNotionalQuote)),
    });
    const candidateId = arbitrage.insertCandidate({
      runId,
      symbol: seed.symbol,
      buyExchange: seed.buyVenue,
      sellExchange: seed.sellVenue,
      detectedAtMs: obs.detectedAtMs,
      buyTopAsk: obs.estimates[0]?.avgBuyPrice ?? 1,
      sellTopBid: obs.estimates[0]?.avgSellPrice ?? 1,
      grossSpreadPct: 0.5,
      approximateNetSpreadPct: 0.3,
      lifecycleId,
    });
    for (const est of obs.estimates) {
      arbitrage.insertEstimate({
        candidateId,
        targetNotionalQuote: est.targetNotionalQuote,
        avgBuyPrice: est.avgBuyPrice,
        avgSellPrice: est.avgSellPrice,
        executableBuyNotional: est.executableBuyNotional,
        executableSellNotional: est.executableSellNotional,
        supportedByDepth: est.supportedByDepth ?? true,
        grossProfitQuote: est.executableSellNotional - est.executableBuyNotional,
        feesQuote: est.feesQuote,
        netProfitQuote: est.netProfitQuote,
        netSpreadPct: est.netSpreadPct,
        tradablePrefunded: est.tradablePrefunded ?? true,
      });
    }
  }
  return lifecycleId;
}

describe('paper simulator (integration)', () => {
  it('replays a single lifecycle, persists the trade, and updates the ledger', () => {
    const runId = 'r-paper-1';
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun(runId));

    seedLifecycle(runId, {
      symbol: 'PYTH/USDT',
      buyVenue: 'bitget',
      sellVenue: 'mexc',
      observations: [
        {
          detectedAtMs: 1_000,
          estimates: [
            {
              targetNotionalQuote: 100,
              executableBuyNotional: 100,
              executableSellNotional: 100.5,
              avgBuyPrice: 0.2,
              avgSellPrice: 0.201,
              feesQuote: 0.2,
              netProfitQuote: 0.3,
              netSpreadPct: 0.3,
            },
            {
              targetNotionalQuote: 1000,
              executableBuyNotional: 1000,
              executableSellNotional: 1002.5,
              avgBuyPrice: 0.2,
              avgSellPrice: 0.2005,
              feesQuote: 0.6,
              netProfitQuote: 1.9,
              netSpreadPct: 0.19,
            },
          ],
        },
      ],
    });

    const lifecycles = new CandidateReplayLoader(db).load(runId);
    expect(lifecycles).toHaveLength(1);

    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 0.1,
      minNetSpreadPct: 0.05,
      maxTargetNotionalQuote: 1000,
    });
    const portfolio = buildAutoPrefundedPortfolio({
      lifecycles,
      quotePerBuyVenue: 5_000,
      baseNotionalPerSellVenue: 5_000,
    });
    expect(portfolio.bitget?.USDT).toBe(5_000);
    expect(portfolio.mexc?.PYTH).toBe(5_000 / 0.2);

    const simulator = new PaperSimulator({
      simulationRunId: 'sim-paper-1',
      sourceScannerRunId: runId,
      policy,
      latencyMs: 0,
      lifecycles,
      initialPortfolio: portfolio,
      feeResolver: new FeeResolver(),
      createdAtMs: 1_700_000_000_000,
    });
    const result = simulator.run();
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.targetNotionalQuote).toBe(1000);
    expect(result.totalNetProfitQuote).toBeCloseTo(1.9, 6);
    expect(result.rejections).toHaveLength(0);

    expect(result.finalPortfolio.bitget?.USDT).toBeLessThan(5_000);
    expect(result.finalPortfolio.mexc?.PYTH).toBeLessThan(5_000 / 0.2);

    new PaperSimulationRepository(db).record(result);
    const trades = new PaperSimulationRepository(db).loadTrades('sim-paper-1');
    expect(trades).toHaveLength(1);
    expect(trades[0]!.targetNotionalQuote).toBe(1000);
  });

  it('rejects short lifecycles at non-zero latency while keeping the long one tradable', () => {
    const runId = 'r-paper-2';
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun(runId));

    // Long lifecycle — survives latency 3_000ms
    seedLifecycle(runId, {
      symbol: 'PYTH/USDT',
      buyVenue: 'bitget',
      sellVenue: 'mexc',
      observations: [
        {
          detectedAtMs: 10_000,
          estimates: [
            {
              targetNotionalQuote: 1000,
              executableBuyNotional: 1000,
              executableSellNotional: 1002.5,
              avgBuyPrice: 0.2,
              avgSellPrice: 0.2005,
              feesQuote: 0.6,
              netProfitQuote: 1.9,
              netSpreadPct: 0.19,
            },
          ],
        },
        {
          detectedAtMs: 30_000,
          estimates: [
            {
              targetNotionalQuote: 1000,
              executableBuyNotional: 1000,
              executableSellNotional: 1001.5,
              avgBuyPrice: 0.2,
              avgSellPrice: 0.2003,
              feesQuote: 0.6,
              netProfitQuote: 0.9,
              netSpreadPct: 0.09,
            },
          ],
        },
      ],
    });
    // Short-lived lifecycle — expires before 3_000ms latency
    seedLifecycle(runId, {
      symbol: 'INJ/USDT',
      buyVenue: 'kucoin',
      sellVenue: 'mexc',
      observations: [
        {
          detectedAtMs: 5_000,
          estimates: [
            {
              targetNotionalQuote: 500,
              executableBuyNotional: 500,
              executableSellNotional: 502,
              avgBuyPrice: 25,
              avgSellPrice: 25.1,
              feesQuote: 0.2,
              netProfitQuote: 1.8,
              netSpreadPct: 0.36,
            },
          ],
        },
      ],
    });

    const lifecycles = new CandidateReplayLoader(db).load(runId);
    expect(lifecycles).toHaveLength(2);

    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 0.1,
      minNetSpreadPct: 0.05,
      maxTargetNotionalQuote: 1000,
    });
    const portfolio = buildAutoPrefundedPortfolio({
      lifecycles,
      quotePerBuyVenue: 5_000,
      baseNotionalPerSellVenue: 5_000,
    });

    const result = new PaperSimulator({
      simulationRunId: 'sim-paper-2',
      sourceScannerRunId: runId,
      policy,
      latencyMs: 3_000,
      lifecycles,
      initialPortfolio: portfolio,
      feeResolver: new FeeResolver(),
      createdAtMs: 1_700_000_000_000,
    }).run();

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.symbol).toBe('PYTH/USDT');
    // The PYTH trade picks the 30_000ms observation (the one that survives t0+L).
    expect(result.trades[0]!.executedAtMs).toBe(30_000);
    expect(result.rejectionsByReason.lifecycle_too_short_for_latency).toBe(1);
  });

  it('rejects when prefunded inventory is missing on the sell venue', () => {
    const runId = 'r-paper-3';
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun(runId));

    seedLifecycle(runId, {
      symbol: 'PYTH/USDT',
      buyVenue: 'bitget',
      sellVenue: 'mexc',
      observations: [
        {
          detectedAtMs: 1_000,
          estimates: [
            {
              targetNotionalQuote: 1000,
              executableBuyNotional: 1000,
              executableSellNotional: 1002.5,
              avgBuyPrice: 0.2,
              avgSellPrice: 0.2005,
              feesQuote: 0.6,
              netProfitQuote: 1.9,
              netSpreadPct: 0.19,
            },
          ],
        },
      ],
    });
    const lifecycles = new CandidateReplayLoader(db).load(runId);
    const portfolioWithoutBase = { bitget: { USDT: 5_000 } };

    const policy = buildPolicy({
      strategy: 'once_per_lifecycle',
      selectionMode: 'best_profit',
      minNetProfitQuote: 0.1,
      minNetSpreadPct: 0.05,
      maxTargetNotionalQuote: 1000,
    });
    const result = new PaperSimulator({
      simulationRunId: 'sim-paper-3',
      sourceScannerRunId: runId,
      policy,
      latencyMs: 0,
      lifecycles,
      initialPortfolio: portfolioWithoutBase,
      feeResolver: new FeeResolver(),
      createdAtMs: 1_700_000_000_000,
    }).run();

    expect(result.trades).toHaveLength(0);
    expect(result.rejectionsByReason.insufficient_base_inventory).toBe(1);
  });
});
