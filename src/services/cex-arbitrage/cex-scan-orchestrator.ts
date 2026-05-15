import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';
import {
  endRun,
  hashConfig,
  startRun,
  type ScannerRun,
} from '../../core/run-context/scanner-run.js';
import { systemClock } from '../../core/time/clock.js';
import { CcxtExchangeAdapter } from '../../adapters/exchanges/ccxt-exchange-adapter.js';
import { ArbitrageRepository } from '../../persistence/repositories/arbitrage-repository.js';
import { ArbitrageLifecycleRepository } from '../../persistence/repositories/arbitrage-lifecycle-repository.js';
import { OrderBookRepository } from '../../persistence/repositories/order-book-repository.js';
import { ScannerRunRepository } from '../../persistence/repositories/scanner-run-repository.js';
import { getDb } from '../../persistence/db.js';

import { ArbitrageDetector } from './arbitrage-detector.js';
import { ArbitrageLifecycleTracker } from './arbitrage-lifecycle-tracker.js';
import { FeeResolver } from './fee-resolver.js';
import { OrderBookCollector } from './order-book-collector.js';

import type { BaseExchangeAdapter } from '../../adapters/exchanges/base-exchange-adapter.js';
import type { CexSymbol } from '../../core/types/market.js';

const log = getLogger('cex.orchestrator');

export interface CexScanOptions {
  durationMs?: number;            // total wall-clock cap; if absent, runs until SIGINT
}

export class CexScanOrchestrator {
  private stopRequested = false;

  async run(opts: CexScanOptions = {}): Promise<ScannerRun> {
    const cfg = getAppConfig();
    if (!cfg.CEX_ENABLED) {
      log.warn('CEX_ENABLED is false; nothing to do');
      return endRun(
        startRun('cex', hashConfig({ note: 'cex-disabled' })),
        'aborted',
        'CEX_ENABLED=false',
      );
    }

    const db = getDb();
    const runs = new ScannerRunRepository(db);
    const books = new OrderBookRepository(db);
    const arb = new ArbitrageRepository(db);
    const lifecycles = new ArbitrageLifecycleRepository(db);
    const fees = new FeeResolver();

    const adapters = this.buildAdapters(cfg.CEX_EXCHANGES);
    const supported = await this.loadSupportedSymbols(adapters);

    const collector = new OrderBookCollector(
      adapters,
      cfg.CEX_SYMBOLS as CexSymbol[],
      cfg.CEX_ORDER_BOOK_DEPTH_LEVELS,
      supported,
    );
    const detector = new ArbitrageDetector(fees, {
      minGrossSpreadPct: cfg.CEX_MIN_GROSS_SPREAD_PCT,
      minApproxNetSpreadPct: cfg.CEX_MIN_APPROX_NET_SPREAD_PCT,
      minExecutableNetSpreadPct: cfg.CEX_MIN_EXECUTABLE_NET_SPREAD_PCT,
      minNetProfitQuote: cfg.CEX_MIN_NET_PROFIT_QUOTE,
      maxBookStalenessMs: cfg.CEX_MAX_BOOK_STALENESS_MS,
      targetNotionals: cfg.CEX_TARGET_NOTIONALS,
    });
    const lifecycleTracker = new ArbitrageLifecycleTracker(
      lifecycles,
      cfg.CEX_OPPORTUNITY_CLOSE_GRACE_MS,
    );

    const configHash = hashConfig({
      exchanges: cfg.CEX_EXCHANGES,
      symbols: cfg.CEX_SYMBOLS,
      depth: cfg.CEX_ORDER_BOOK_DEPTH_LEVELS,
      notionals: cfg.CEX_TARGET_NOTIONALS,
      thresholds: {
        gross: cfg.CEX_MIN_GROSS_SPREAD_PCT,
        approxNet: cfg.CEX_MIN_APPROX_NET_SPREAD_PCT,
        execNet: cfg.CEX_MIN_EXECUTABLE_NET_SPREAD_PCT,
        netProfit: cfg.CEX_MIN_NET_PROFIT_QUOTE,
        staleness: cfg.CEX_MAX_BOOK_STALENESS_MS,
        closeGrace: cfg.CEX_OPPORTUNITY_CLOSE_GRACE_MS,
      },
    });
    const run = startRun('cex', configHash);
    runs.insert(run);

    const stop = () => {
      this.stopRequested = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const started = systemClock.nowMs();
    const persistMode = cfg.CEX_PERSIST_BOOK_SNAPSHOTS;

    try {
      let iter = 0;
      while (!this.stopRequested) {
        if (opts.durationMs && systemClock.nowMs() - started >= opts.durationMs) break;
        iter++;
        const loopStart = systemClock.nowMs();

        const collected = await collector.collectAll();

        // Persist books if asked (default: opportunities-only — handled later).
        const persistAlways = persistMode === 'all';

        let cycleCandidates = 0;
        let cycleMaterial = 0;

        for (const { symbol, books: byVenue } of collected) {
          if (byVenue.length < 2) continue;

          const candidates = detector.detect(symbol, byVenue);
          cycleCandidates += candidates.length;

          // Persist book snapshots conditionally.
          if (persistAlways) {
            for (const b of byVenue) {
              books.insert({
                runId: run.runId,
                exchange: b.venue,
                symbol,
                book: b.book,
                storeDepthJson: false,
              });
            }
          }

          for (const candidate of candidates) {
            // opportunities_only: persist the two books that supplied the candidate
            if (persistMode === 'opportunities_only') {
              const buyBook = byVenue.find((b) => b.venue === candidate.buyExchange);
              const sellBook = byVenue.find((b) => b.venue === candidate.sellExchange);
              if (buyBook) {
                books.insert({
                  runId: run.runId,
                  exchange: buyBook.venue,
                  symbol,
                  book: buyBook.book,
                  storeDepthJson: true,
                });
              }
              if (sellBook) {
                books.insert({
                  runId: run.runId,
                  exchange: sellBook.venue,
                  symbol,
                  book: sellBook.book,
                  storeDepthJson: true,
                });
              }
            }

            const lifecycleId = lifecycleTracker.recordObservation(run.runId, candidate);
            const candidateId = arb.insertCandidate({
              runId: run.runId,
              symbol: candidate.symbol,
              buyExchange: candidate.buyExchange,
              sellExchange: candidate.sellExchange,
              detectedAtMs: candidate.detectedAtMs,
              buyTopAsk: candidate.buyTopAsk,
              sellTopBid: candidate.sellTopBid,
              grossSpreadPct: candidate.grossSpreadPct,
              approximateNetSpreadPct: candidate.approxNetSpreadPct,
              lifecycleId,
            });
            for (const est of candidate.estimates) {
              arb.insertEstimate({
                candidateId,
                targetNotionalQuote: est.targetNotionalQuote,
                avgBuyPrice: est.avgBuyPrice,
                avgSellPrice: est.avgSellPrice,
                executableBuyNotional: est.executableBuyNotional,
                executableSellNotional: est.executableSellNotional,
                supportedByDepth: est.supportedByDepth,
                grossProfitQuote: est.grossProfitQuote,
                feesQuote: est.feesQuote,
                netProfitQuote: est.netProfitQuote,
                netSpreadPct: est.netSpreadPct,
                tradablePrefunded: est.tradablePrefunded,
              });
            }
            if (candidate.isMaterial) cycleMaterial++;
          }
        }

        lifecycleTracker.closeIdleLifecycles();

        log.info(
          {
            iter,
            symbols: collected.length,
            candidates: cycleCandidates,
            material: cycleMaterial,
            elapsedMs: systemClock.nowMs() - loopStart,
          },
          'scan cycle complete',
        );

        const elapsed = systemClock.nowMs() - loopStart;
        const sleep = Math.max(0, cfg.CEX_SCAN_INTERVAL_MS - elapsed);
        if (sleep > 0) await systemClock.sleep(sleep);
      }
      endRun(run, 'completed');
      runs.finalize(run);
      return run;
    } catch (err) {
      log.error({ err }, 'scan loop crashed');
      endRun(run, 'failed', (err as Error).message);
      runs.finalize(run);
      throw err;
    }
  }

  private buildAdapters(ids: string[]): BaseExchangeAdapter[] {
    const out: BaseExchangeAdapter[] = [];
    for (const id of ids) {
      try {
        out.push(new CcxtExchangeAdapter(id, displayName(id)));
      } catch (err) {
        log.error({ id, err: (err as Error).message }, 'failed to build adapter');
      }
    }
    return out;
  }

  private async loadSupportedSymbols(
    adapters: BaseExchangeAdapter[],
  ): Promise<Map<string, Set<CexSymbol>>> {
    const out = new Map<string, Set<CexSymbol>>();
    for (const a of adapters) {
      try {
        out.set(a.id, await a.loadMarkets());
      } catch (err) {
        log.warn({ id: a.id, err: (err as Error).message }, 'loadMarkets failed');
        out.set(a.id, new Set());
      }
    }
    return out;
  }
}

function displayName(id: string): string {
  switch (id) {
    case 'binance':
      return 'Binance';
    case 'gateio':
      return 'Gate.io';
    case 'kucoin':
      return 'KuCoin';
    case 'mexc':
      return 'MEXC';
    default:
      return id;
  }
}
