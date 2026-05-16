import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDbAt } from '../../persistence/db.js';
import { ArbitrageLifecycleRepository } from '../../persistence/repositories/arbitrage-lifecycle-repository.js';
import { ArbitrageRepository } from '../../persistence/repositories/arbitrage-repository.js';
import { ScannerRunRepository } from '../../persistence/repositories/scanner-run-repository.js';
import { CexReportService } from '../../services/cex-arbitrage/cex-report-service.js';

let dbPath: string;
let workdir: string;

beforeEach(() => {
  workdir = join(tmpdir(), `arb-bot-report-tests-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workdir, { recursive: true });
  dbPath = join(workdir, 'observatory.sqlite');
});

afterEach(() => {
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // noop
  }
});

function scannerRun(runId: string) {
  return {
    runId,
    mode: 'cex' as const,
    startedAtMs: 1,
    endedAtMs: 3_600_001,
    configHash: 'h',
    status: 'completed' as const,
    totalCycles: 6,
    totalSymbolsScanned: 30,
    totalCandidates: 3,
    totalMaterialCandidates: 1,
    actualElapsedMs: 3_600_000,
  };
}

describe('CexReportService', () => {
  it('summarizes single vs multi-observation lifecycles and audits best attached estimates', () => {
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun('r1'));

    const lifecycles = new ArbitrageLifecycleRepository(db);
    const arbitrage = new ArbitrageRepository(db);

    const multiLifecycleId = lifecycles.upsertOpen({
      runId: 'r1',
      eventKey: 'cex:BNB/USDT:binance:kucoin',
      symbol: 'BNB/USDT',
      buyExchange: 'binance',
      sellExchange: 'kucoin',
      observedAtMs: 1_000,
      grossSpreadPct: 0.8,
      approxNetSpreadPct: 0.4,
      netProfitQuote: 1.5,
      supportedNotionalQuote: 100,
    });
    const firstCandidateId = arbitrage.insertCandidate({
      runId: 'r1',
      symbol: 'BNB/USDT',
      buyExchange: 'binance',
      sellExchange: 'kucoin',
      detectedAtMs: 1_000,
      buyTopAsk: 600,
      sellTopBid: 605,
      grossSpreadPct: 0.8,
      approximateNetSpreadPct: 0.4,
      lifecycleId: multiLifecycleId,
    });
    arbitrage.insertEstimate({
      candidateId: firstCandidateId,
      targetNotionalQuote: 100,
      avgBuyPrice: 600,
      avgSellPrice: 605,
      executableBuyNotional: 100,
      executableSellNotional: 100.83,
      supportedByDepth: true,
      grossProfitQuote: 0.83,
      feesQuote: 0.2,
      netProfitQuote: 0.63,
      netSpreadPct: 0.63,
      tradablePrefunded: true,
    });

    const sameLifecycleId = lifecycles.upsertOpen({
      runId: 'r1',
      eventKey: 'cex:BNB/USDT:binance:kucoin',
      symbol: 'BNB/USDT',
      buyExchange: 'binance',
      sellExchange: 'kucoin',
      observedAtMs: 2_000,
      grossSpreadPct: 1.1,
      approxNetSpreadPct: 0.7,
      netProfitQuote: 6.2,
      supportedNotionalQuote: 500,
    });
    expect(sameLifecycleId).toBe(multiLifecycleId);

    const bestCandidateId = arbitrage.insertCandidate({
      runId: 'r1',
      symbol: 'BNB/USDT',
      buyExchange: 'binance',
      sellExchange: 'kucoin',
      detectedAtMs: 2_000,
      buyTopAsk: 600,
      sellTopBid: 606.6,
      grossSpreadPct: 1.1,
      approximateNetSpreadPct: 0.7,
      lifecycleId: multiLifecycleId,
    });
    arbitrage.insertEstimate({
      candidateId: bestCandidateId,
      targetNotionalQuote: 500,
      avgBuyPrice: 600,
      avgSellPrice: 606.6,
      executableBuyNotional: 500,
      executableSellNotional: 505.5,
      supportedByDepth: true,
      grossProfitQuote: 5.5,
      feesQuote: 0.7,
      netProfitQuote: 4.8,
      netSpreadPct: 0.96,
      tradablePrefunded: true,
    });
    lifecycles.closeStale(3_000, 4_000);

    const singleLifecycleId = lifecycles.upsertOpen({
      runId: 'r1',
      eventKey: 'cex:SOL/USDT:okx:bybit',
      symbol: 'SOL/USDT',
      buyExchange: 'okx',
      sellExchange: 'bybit',
      observedAtMs: 5_000,
      grossSpreadPct: 0.5,
      approxNetSpreadPct: 0.2,
      netProfitQuote: 0.4,
      supportedNotionalQuote: 100,
    });
    const singleCandidateId = arbitrage.insertCandidate({
      runId: 'r1',
      symbol: 'SOL/USDT',
      buyExchange: 'okx',
      sellExchange: 'bybit',
      detectedAtMs: 5_000,
      buyTopAsk: 150,
      sellTopBid: 150.75,
      grossSpreadPct: 0.5,
      approximateNetSpreadPct: 0.2,
      lifecycleId: singleLifecycleId,
    });
    arbitrage.insertEstimate({
      candidateId: singleCandidateId,
      targetNotionalQuote: 100,
      avgBuyPrice: 150,
      avgSellPrice: 150.75,
      executableBuyNotional: 100,
      executableSellNotional: 100.5,
      supportedByDepth: true,
      grossProfitQuote: 0.5,
      feesQuote: 0.2,
      netProfitQuote: 0.3,
      netSpreadPct: 0.3,
      tradablePrefunded: true,
    });

    const report = new CexReportService(db);
    const summary = report.summary('r1');

    expect(summary.distinctOpportunityLifecycles).toBe(2);
    expect(summary.singleObservationLifecycles).toBe(1);
    expect(summary.multiObservationLifecycles).toBe(1);
    expect(summary.actualElapsedMs).toBe(3_600_000);
    expect(summary.totalCycles).toBe(6);
    expect(summary.totalSymbolsScanned).toBe(30);
    expect(summary.totalCandidates).toBe(3);
    expect(summary.totalMaterialCandidates).toBe(1);
    expect(summary.candidatesPerHour).toBe(3);
    expect(summary.lifecyclesPerHour).toBe(2);
    expect(summary.opportunitiesDetected).toBe(2);

    const top = report.topLifecycles(10, 'r1');
    const first = top[0];
    expect(first).toBeDefined();
    expect(first!.id).toBe(multiLifecycleId);
    expect(first!.eventKey).toBe('cex:BNB/USDT:binance:kucoin');
    expect(first!.firstSeenAtMs).toBe(1_000);
    expect(first!.lastSeenAtMs).toBe(2_000);
    expect(first!.endedAtMs).toBe(2_000);
    expect(first!.effectiveDurationMs).toBe(1_000);
    expect(first!.observationCount).toBe(2);
    expect(first!.status).toBe('closed');
    expect(first!.maxApproxNetSpreadPct).toBeCloseTo(0.7, 6);
    expect(first!.bestEstimate).toMatchObject({
      candidateId: bestCandidateId,
      detectedAtMs: 2_000,
      targetNotionalQuote: 500,
      netProfitQuote: 4.8,
      netSpreadPct: 0.96,
      supportedByDepth: true,
      tradablePrefunded: true,
    });
  });

  it('reports operational context for zero-candidate runs', () => {
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert({
      ...scannerRun('r-zero'),
      totalCandidates: 0,
      totalMaterialCandidates: 0,
    });

    const summary = new CexReportService(db).summary('r-zero');

    expect(summary.rawCandidates).toBe(0);
    expect(summary.distinctOpportunityLifecycles).toBe(0);
    expect(summary.opportunitiesDetected).toBe(0);
    expect(summary.actualElapsedMs).toBe(3_600_000);
    expect(summary.totalCycles).toBe(6);
    expect(summary.candidatesPerHour).toBe(0);
    expect(summary.lifecyclesPerHour).toBe(0);
  });
});
