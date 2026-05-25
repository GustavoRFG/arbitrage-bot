import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';
import {
  endRun,
  hashConfig,
  startRun,
  type ScannerRun,
  type ScannerRunUniverse,
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
import { buildMaterialRule } from './material-rule.js';
import { OrderBookCollector } from './order-book-collector.js';
import { resolveSymbolUniverse } from './symbol-universe-resolver.js';

import type { BaseExchangeAdapter } from '../../adapters/exchanges/base-exchange-adapter.js';
import type { CexSymbol } from '../../core/types/market.js';

const log = getLogger('cex.orchestrator');

export interface CexScanOptions {
  durationMs?: number;            // total wall-clock cap; if absent, runs until SIGINT
}

export class CexScanOrchestrator {
  private stopRequested = false;

  async run(opts: CexScanOptions = {}): Promise<ScannerRun> {
    this.stopRequested = false;
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
    if (adapters.length === 0) {
      log.error({ requested: cfg.CEX_EXCHANGES }, 'no usable exchange adapters; aborting');
      return endRun(
        startRun('cex', hashConfig({ note: 'no-adapters' })),
        'aborted',
        'no usable exchange adapters',
      );
    }
    const supported = await this.loadSupportedSymbols(adapters);

    const universe = resolveSymbolUniverse({
      mode: cfg.CEX_SYMBOL_MODE,
      configuredSymbols: cfg.CEX_SYMBOLS as CexSymbol[],
      supportedSymbolsByVenue: supported,
      minVenuesPerSymbol: cfg.CEX_MIN_VENUES_PER_SYMBOL,
      maxSymbols: cfg.CEX_MAX_SYMBOLS,
    });

    if (universe.symbols.length === 0) {
      log.error(
        { mode: cfg.CEX_SYMBOL_MODE, exchanges: adapters.map((a) => a.id) },
        'symbol resolution yielded zero symbols; aborting',
      );
      return endRun(
        startRun('cex', hashConfig({ note: 'no-symbols' })),
        'aborted',
        'symbol universe is empty after resolution',
      );
    }

    const materialRule = buildMaterialRule({
      minNetProfitQuote: cfg.CEX_MIN_NET_PROFIT_QUOTE,
      minExecutableNetSpreadPct: cfg.CEX_MIN_EXECUTABLE_NET_SPREAD_PCT,
    });

    const runUniverse: ScannerRunUniverse = {
      symbolMode: universe.mode,
      enabledExchanges: adapters.map((a) => a.id),
      resolvedSymbols: universe.symbols,
      minVenuesPerSymbol: cfg.CEX_MIN_VENUES_PER_SYMBOL,
      maxSymbols: cfg.CEX_MAX_SYMBOLS,
      truncated: universe.truncated,
      materialRule,
    };

    // Predicted per-cycle work: every (venue × symbol) pair is one REST call.
    // The estimate is intentionally conservative because parallelism per-symbol
    // means actual elapsed is usually lower; the warning is a sanity gate.
    const requestsPerCycle = universe.symbols.length * adapters.length;
    const predictedMs = requestsPerCycle * cfg.CEX_EXPECTED_MS_PER_REQUEST / Math.max(1, adapters.length);
    if (predictedMs > cfg.CEX_SLOW_CYCLE_WARN_MS) {
      log.warn(
        {
          requestsPerCycle,
          predictedMs: Math.round(predictedMs),
          warnBudgetMs: cfg.CEX_SLOW_CYCLE_WARN_MS,
          scanIntervalMs: cfg.CEX_SCAN_INTERVAL_MS,
        },
        'predicted cycle work exceeds CEX_SLOW_CYCLE_WARN_MS — consider shrinking the universe or moving to WebSocket adapters',
      );
    }

    this.logStartupBanner({
      adapters,
      universe: runUniverse,
      cfg: {
        scanIntervalMs: cfg.CEX_SCAN_INTERVAL_MS,
        targetNotionals: cfg.CEX_TARGET_NOTIONALS,
        depthLevels: cfg.CEX_ORDER_BOOK_DEPTH_LEVELS,
        persistMode: cfg.CEX_PERSIST_BOOK_SNAPSHOTS,
      },
    });

    const collector = new OrderBookCollector(
      adapters,
      universe.symbols,
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
      exchanges: runUniverse.enabledExchanges,
      symbolMode: cfg.CEX_SYMBOL_MODE,
      symbols: universe.symbols,
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
    run.universeJson = JSON.stringify(runUniverse);
    runs.insert(run);

    let signalReceived = false;
    let finalized = false;
    const finalizeRun = (status: Parameters<typeof endRun>[1], notes?: string): void => {
      if (finalized) return;
      endRun(run, status, notes);
      runs.finalize(run);
      finalized = true;
    };
    let wakeStop: (() => void) | undefined;
    const sleepOrStop = (ms: number): Promise<void> => {
      if (ms <= 0 || this.stopRequested) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          if (wakeStop === finish) wakeStop = undefined;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        wakeStop = finish;
      });
    };
    const stop = () => {
      signalReceived = true;
      this.stopRequested = true;
      wakeStop?.();
      finalizeRun('interrupted', 'process interruption signal received');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const started = systemClock.nowMs();
    const persistMode = cfg.CEX_PERSIST_BOOK_SNAPSHOTS;

    try {
      let iter = 0;
      while (!this.stopRequested) {
        if (opts.durationMs !== undefined && systemClock.nowMs() - started >= opts.durationMs) break;
        iter++;
        const loopStart = systemClock.nowMs();

        const collected = await collector.collectAll();
        if (this.stopRequested) break;

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
            // isMaterial is the predicate defined in material-rule.ts and
            // evaluated inside ArbitrageDetector.detect(): a candidate is
            // material when at least one of its depth estimates fills both
            // legs at the target notional AND meets the configured netProfit
            // + executableNetSpread floors.
            if (candidate.isMaterial) cycleMaterial++;
          }
        }

        lifecycleTracker.closeIdleLifecycles();
        run.totalCycles = iter;
        run.totalSymbolsScanned += collected.length;
        run.totalCandidates += cycleCandidates;
        run.totalMaterialCandidates += cycleMaterial;
        run.actualElapsedMs = systemClock.nowMs() - run.startedAtMs;
        if (!finalized) runs.updateProgress(run);

        const elapsedMs = systemClock.nowMs() - loopStart;
        log.info(
          {
            iter,
            symbols: collected.length,
            candidates: cycleCandidates,
            material: cycleMaterial,
            elapsedMs,
          },
          'scan cycle complete',
        );
        if (elapsedMs > cfg.CEX_SLOW_CYCLE_WARN_MS) {
          log.warn(
            { iter, elapsedMs, warnBudgetMs: cfg.CEX_SLOW_CYCLE_WARN_MS },
            'cycle elapsedMs exceeded the configured warning budget',
          );
        }

        const sleep = Math.max(0, cfg.CEX_SCAN_INTERVAL_MS - elapsedMs);
        if (sleep > 0) await sleepOrStop(sleep);
      }
      finalizeRun(signalReceived ? 'interrupted' : 'completed');
      return run;
    } catch (err) {
      log.error({ err }, 'scan loop crashed');
      finalizeRun('failed', (err as Error).message);
      throw err;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
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

  private logStartupBanner(args: {
    adapters: BaseExchangeAdapter[];
    universe: ScannerRunUniverse;
    cfg: {
      scanIntervalMs: number;
      targetNotionals: number[];
      depthLevels: number;
      persistMode: string;
    };
  }): void {
    const symbols = args.universe.resolvedSymbols;
    const preview =
      symbols.length <= 20
        ? symbols.join(', ')
        : symbols.slice(0, 20).join(', ') + `, … (+${symbols.length - 20} more)`;
    log.info(
      {
        exchanges: args.adapters.map((a) => `${a.id}(${a.name})`),
        symbolMode: args.universe.symbolMode,
        symbolsCount: symbols.length,
        symbolsPreview: preview,
        minVenuesPerSymbol: args.universe.minVenuesPerSymbol,
        maxSymbols: args.universe.maxSymbols,
        truncated: args.universe.truncated,
        materialRule: args.universe.materialRule.description,
        scanIntervalMs: args.cfg.scanIntervalMs,
        targetNotionals: args.cfg.targetNotionals,
        depthLevels: args.cfg.depthLevels,
        persistMode: args.cfg.persistMode,
      },
      'CEX scan startup — resolved universe & material rule',
    );
  }
}

function displayName(id: string): string {
  switch (id) {
    case 'binance':   return 'Binance';
    case 'gateio':    return 'Gate.io';
    case 'kucoin':    return 'KuCoin';
    case 'mexc':      return 'MEXC';
    case 'coinex':    return 'CoinEx';
    case 'coinbase':  return 'Coinbase';
    case 'bitget':    return 'Bitget';
    case 'bitfinex':  return 'Bitfinex';
    case 'htx':       return 'HTX';
    case 'okx':       return 'OKX';
    case 'bybit':     return 'Bybit';
    case 'kraken':    return 'Kraken';
    case 'bingx':     return 'BingX';
    case 'cryptocom': return 'Crypto.com';
    default:          return id;
  }
}
