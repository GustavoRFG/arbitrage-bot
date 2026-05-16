import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDbAt } from '../../persistence/db.js';
import { ArbitrageLifecycleRepository } from '../../persistence/repositories/arbitrage-lifecycle-repository.js';
import { ArbitrageRepository } from '../../persistence/repositories/arbitrage-repository.js';
import { OrderBookRepository } from '../../persistence/repositories/order-book-repository.js';
import {
  CryptoReferenceRepository,
  PolymarketMarketRepository,
  PolymarketSnapshotRepository,
  RepricingEventRepository,
} from '../../persistence/repositories/polymarket-repository.js';
import { ScannerRunRepository } from '../../persistence/repositories/scanner-run-repository.js';

let dbPath: string;
let workdir: string;

beforeEach(() => {
  workdir = join(tmpdir(), `arb-bot-tests-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workdir, { recursive: true });
  dbPath = join(workdir, 'observatory.sqlite');
});

afterEach(() => {
  try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
});

function scannerRun(runId: string) {
  return {
    runId,
    mode: 'cex' as const,
    startedAtMs: 1,
    configHash: 'h',
    status: 'running' as const,
    totalCycles: 0,
    totalSymbolsScanned: 0,
    totalCandidates: 0,
    totalMaterialCandidates: 0,
  };
}

describe('persistence layer', () => {
  it('creates schema and inserts a scanner run', () => {
    const db = openDbAt(dbPath);
    const runs = new ScannerRunRepository(db);
    runs.insert({ ...scannerRun('r1'), configHash: 'abcd' });
    const row = db.prepare('SELECT * FROM scanner_runs WHERE run_id=?').get('r1') as {
      run_id: string;
      status: string;
      total_cycles: number;
    };
    expect(row.run_id).toBe('r1');
    expect(row.status).toBe('running');
    expect(row.total_cycles).toBe(0);
  });

  it('finalizes scanner runs with operational counters and interrupted status', () => {
    const db = openDbAt(dbPath);
    const runs = new ScannerRunRepository(db);
    const run = scannerRun('r1');
    runs.insert(run);

    runs.finalize({
      ...run,
      status: 'interrupted',
      endedAtMs: 1_501,
      totalCycles: 3,
      totalSymbolsScanned: 15,
      totalCandidates: 4,
      totalMaterialCandidates: 2,
      actualElapsedMs: 1_500,
    });

    const row = db.prepare('SELECT * FROM scanner_runs WHERE run_id=?').get('r1') as {
      status: string;
      ended_at: number;
      total_cycles: number;
      total_symbols_scanned: number;
      total_candidates: number;
      total_material_candidates: number;
      actual_elapsed_ms: number;
    };
    expect(row.status).toBe('interrupted');
    expect(row.ended_at).toBe(1_501);
    expect(row.total_cycles).toBe(3);
    expect(row.total_symbols_scanned).toBe(15);
    expect(row.total_candidates).toBe(4);
    expect(row.total_material_candidates).toBe(2);
    expect(row.actual_elapsed_ms).toBe(1_500);
  });

  it('inserts a CEX candidate with two estimates', () => {
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun('r1'));
    const arb = new ArbitrageRepository(db);
    const id = arb.insertCandidate({
      runId: 'r1',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'gateio',
      detectedAtMs: 100,
      buyTopAsk: 100,
      sellTopBid: 101,
      grossSpreadPct: 1.0,
      approximateNetSpreadPct: 0.7,
    });
    arb.insertEstimate({
      candidateId: id,
      targetNotionalQuote: 100,
      avgBuyPrice: 100,
      avgSellPrice: 101,
      executableBuyNotional: 100,
      executableSellNotional: 101,
      supportedByDepth: true,
      grossProfitQuote: 1,
      feesQuote: 0.2,
      netProfitQuote: 0.8,
      netSpreadPct: 0.8,
      tradablePrefunded: true,
    });
    arb.insertEstimate({
      candidateId: id,
      targetNotionalQuote: 500,
      avgBuyPrice: 100.1,
      avgSellPrice: 100.95,
      executableBuyNotional: 500,
      executableSellNotional: 504.75,
      supportedByDepth: true,
      grossProfitQuote: 4.75,
      feesQuote: 1.0,
      netProfitQuote: 3.75,
      netSpreadPct: 0.75,
      tradablePrefunded: true,
    });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM cex_opportunity_estimates').get() as { n: number }).n;
    expect(n).toBe(2);
  });

  it('arbitrage lifecycle: opens, accumulates max stats, closes when stale', () => {
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun('r1'));
    const lc = new ArbitrageLifecycleRepository(db);
    const id1 = lc.upsertOpen({
      runId: 'r1',
      eventKey: 'cex:BTC/USDT:binance:gateio',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'gateio',
      observedAtMs: 1_000,
      grossSpreadPct: 0.5,
      approxNetSpreadPct: 0.3,
      netProfitQuote: 1,
      supportedNotionalQuote: 100,
    });
    const id2 = lc.upsertOpen({
      runId: 'r1',
      eventKey: 'cex:BTC/USDT:binance:gateio',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'gateio',
      observedAtMs: 2_000,
      grossSpreadPct: 0.9, // higher max
      approxNetSpreadPct: 0.7,
      netProfitQuote: 5,
      supportedNotionalQuote: 500,
    });
    expect(id1).toBe(id2);

    const closed = lc.closeStale(3_000, 4_000);
    expect(closed).toBe(1);
    const row = db
      .prepare('SELECT * FROM cex_arbitrage_lifecycles WHERE id = ?')
      .get(id1) as {
      status: string;
      duration_ms: number;
      observation_count: number;
      max_gross_spread_pct: number;
      max_net_profit_quote: number;
      max_supported_notional_quote: number;
    };
    expect(row.status).toBe('closed');
    expect(row.duration_ms).toBe(1_000);
    expect(row.observation_count).toBe(2);
    expect(row.max_gross_spread_pct).toBeCloseTo(0.9, 6);
    expect(row.max_net_profit_quote).toBe(5);
    expect(row.max_supported_notional_quote).toBe(500);
  });

  it('order book snapshot insert records top-of-book prices', () => {
    const db = openDbAt(dbPath);
    new ScannerRunRepository(db).insert(scannerRun('r1'));
    const repo = new OrderBookRepository(db);
    repo.insert({
      runId: 'r1',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      storeDepthJson: false,
      book: {
        venue: 'binance',
        symbolOrMarketId: 'BTC/USDT',
        bids: [{ price: 99.9, amountBaseOrShares: 1, notionalQuote: 99.9 }],
        asks: [{ price: 100, amountBaseOrShares: 1, notionalQuote: 100 }],
        timestamps: { receivedAtMs: 1 },
      },
    });
    const row = db
      .prepare('SELECT top_bid, top_ask FROM cex_order_book_snapshots LIMIT 1')
      .get() as { top_bid: number; top_ask: number };
    expect(row.top_bid).toBe(99.9);
    expect(row.top_ask).toBe(100);
  });

  it('polymarket repos round-trip a market, snapshot and event', () => {
    const db = openDbAt(dbPath);
    const markets = new PolymarketMarketRepository(db);
    const snaps = new PolymarketSnapshotRepository(db);
    const refs = new CryptoReferenceRepository(db);
    const events = new RepricingEventRepository(db);

    markets.upsert({
      id: 'm1',
      asset: 'BTC',
      horizon: '5m',
      startTimeMs: 1_000,
      endTimeMs: 1_300,
      yesTokenId: 'yes',
      noTokenId: 'no',
      referenceOpenPrice: 100_000,
      feesEnabled: false,
    });
    expect((db.prepare('SELECT COUNT(*) AS n FROM polymarket_short_horizon_markets').get() as { n: number }).n).toBe(1);

    refs.insert(null, {
      asset: 'BTC',
      source: 'binance',
      price: 100_500,
      timestamps: { receivedAtMs: 1_100 },
    });
    snaps.insertOrderBook(null, {
      marketId: 'm1',
      capturedAtMs: 1_100,
      yesMidpoint: 0.5,
    }, 'YES');
    events.insert(null, {
      marketId: 'm1',
      asset: 'BTC',
      horizon: '5m',
      detectedAtMs: 1_100,
      eventType: 'reference_move_clob_lag',
      referenceSource: 'binance',
      referenceMovePct: 0.5,
      timeToExpiryMs: 200,
      lagMsEstimate: 250,
    });
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM crypto_reference_snapshots) AS refs,
           (SELECT COUNT(*) FROM polymarket_orderbook_snapshots) AS books,
           (SELECT COUNT(*) FROM repricing_lag_candidates) AS evts`,
      )
      .get() as { refs: number; books: number; evts: number };
    expect(counts).toEqual({ refs: 1, books: 1, evts: 1 });
  });
});
