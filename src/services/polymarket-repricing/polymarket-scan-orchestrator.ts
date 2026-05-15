import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';
import {
  endRun,
  hashConfig,
  startRun,
  type ScannerRun,
} from '../../core/run-context/scanner-run.js';
import { systemClock } from '../../core/time/clock.js';
import { PolymarketMarketDiscoveryAdapter } from '../../adapters/polymarket/polymarket-market-discovery-adapter.js';
import { PolymarketOrderBookAdapter } from '../../adapters/polymarket/polymarket-orderbook-adapter.js';
import { getDb } from '../../persistence/db.js';
import {
  CryptoReferenceRepository,
  PolymarketMarketRepository,
  PolymarketSnapshotRepository,
  RepricingEventRepository,
} from '../../persistence/repositories/polymarket-repository.js';
import { ScannerRunRepository } from '../../persistence/repositories/scanner-run-repository.js';

import { CryptoReferenceFeedService } from './crypto-reference-feed-service.js';
import { MarketResolverService } from './market-resolver-service.js';
import { PolymarketClobCollector } from './polymarket-clob-collector.js';
import { buildFeatureSnapshot } from './polymarket-features.js';
import { detectRepricingLag } from './repricing-lag-detector.js';
import { RepricingLifecycleTracker } from './repricing-lifecycle-tracker.js';

import type {
  CryptoReferenceSnapshot,
  PolymarketMarketSnapshot,
} from '../../core/types/polymarket.js';

const log = getLogger('poly.orchestrator');

/**
 * Phase 1 SKELETON orchestrator. The pipeline is fully wired (resolver ->
 * reference feed -> CLOB collector -> features -> lag detector -> lifecycle
 * tracker -> repositories), but the live adapters are P3 stubs. When the
 * Gamma/CLOB integrations are added, this loop will start producing data
 * without further changes.
 */
export interface PolymarketScanOptions {
  durationMs?: number;
}

export class PolymarketScanOrchestrator {
  private stopRequested = false;

  async run(opts: PolymarketScanOptions = {}): Promise<ScannerRun> {
    const cfg = getAppConfig();
    if (!cfg.POLYMARKET_ENABLED) {
      log.warn('POLYMARKET_ENABLED is false; skipping');
      return endRun(
        startRun('polymarket', hashConfig({ note: 'poly-disabled' })),
        'aborted',
        'POLYMARKET_ENABLED=false',
      );
    }

    const db = getDb();
    const runs = new ScannerRunRepository(db);
    const marketRepo = new PolymarketMarketRepository(db);
    const snapRepo = new PolymarketSnapshotRepository(db);
    const refRepo = new CryptoReferenceRepository(db);
    const eventRepo = new RepricingEventRepository(db);

    const discovery = new PolymarketMarketDiscoveryAdapter();
    const orderbook = new PolymarketOrderBookAdapter();
    const resolver = new MarketResolverService(discovery, marketRepo);
    const refFeed = new CryptoReferenceFeedService();
    const clobCollector = new PolymarketClobCollector(orderbook);
    const lifecycleTracker = new RepricingLifecycleTracker(
      db,
      cfg.POLYMARKET_REPRICING_CLOSE_GRACE_MS,
    );

    const configHash = hashConfig({
      assets: cfg.POLYMARKET_ASSETS,
      horizons: cfg.POLYMARKET_HORIZONS,
      thresholds: {
        refMove: cfg.POLYMARKET_REFERENCE_MOVE_THRESHOLD_PCT,
        lateWindow: cfg.POLYMARKET_LATE_WINDOW_THRESHOLD_MS,
        distance: cfg.POLYMARKET_DISTANCE_FROM_OPEN_THRESHOLD_PCT,
        staleness: cfg.POLYMARKET_MAX_BOOK_STALENESS_MS,
        closeGrace: cfg.POLYMARKET_REPRICING_CLOSE_GRACE_MS,
      },
    });
    const run = startRun('polymarket', configHash);
    runs.insert(run);

    const stop = () => {
      this.stopRequested = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const refHistory = new Map<string, CryptoReferenceSnapshot[]>();
    const clobHistory = new Map<string, PolymarketMarketSnapshot[]>();
    const HISTORY_WINDOW = 32;

    const started = systemClock.nowMs();

    try {
      let iter = 0;
      while (!this.stopRequested) {
        if (opts.durationMs && systemClock.nowMs() - started >= opts.durationMs) break;
        iter++;
        const loopStart = systemClock.nowMs();

        // 1. Resolve active markets per asset/horizon (returns [] in skeleton).
        const allMarkets = (
          await Promise.all(
            cfg.POLYMARKET_ASSETS.flatMap((asset) =>
              cfg.POLYMARKET_HORIZONS.map((horizon) => resolver.resolveAndPersist(asset, horizon)),
            ),
          )
        ).flat();

        // 2. Refresh reference feeds.
        const refSnapshots = new Map<string, CryptoReferenceSnapshot>();
        if (cfg.POLYMARKET_TRACK_BINANCE_FEED) {
          for (const asset of cfg.POLYMARKET_ASSETS) {
            const snap = await refFeed.fetchBinanceSpot(asset);
            if (snap) {
              refRepo.insert(run.runId, snap);
              refSnapshots.set(`${asset}:binance`, snap);
              const arr = refHistory.get(`${asset}:binance`) ?? [];
              arr.push(snap);
              if (arr.length > HISTORY_WINDOW) arr.shift();
              refHistory.set(`${asset}:binance`, arr);
            }
          }
        }

        // 3. For each market, snapshot the CLOB and run features + detector.
        let candidatesEmitted = 0;
        for (const market of allMarkets) {
          const clob = await clobCollector.fetchSnapshot(market);
          if (!clob) continue;
          snapRepo.insertOrderBook(run.runId, clob, 'BOTH');

          const arr = clobHistory.get(market.id) ?? [];
          arr.push(clob);
          if (arr.length > HISTORY_WINDOW) arr.shift();
          clobHistory.set(market.id, arr);

          const binance = refSnapshots.get(`${market.asset}:binance`);
          const featureBuildArgs: Parameters<typeof buildFeatureSnapshot>[0] = {
            market,
            clob,
            nowMs: systemClock.nowMs(),
          };
          if (binance) featureBuildArgs.binance = binance;
          const feature = buildFeatureSnapshot(featureBuildArgs);
          if (cfg.POLYMARKET_STORE_FEATURE_SNAPSHOTS) {
            snapRepo.insertFeatureSnapshot(feature);
          }

          const candidates = detectRepricingLag({
            market,
            binanceFeed: refHistory.get(`${market.asset}:binance`) ?? [],
            clobFeed: arr,
            feeAssumption: {
              feeRate: market.feeRate ?? undefined,
              source: market.feeRate !== undefined ? 'api' : 'unknown',
            },
            thresholds: {
              referenceMovePctThreshold: cfg.POLYMARKET_REFERENCE_MOVE_THRESHOLD_PCT,
              distanceFromOpenPctThreshold: cfg.POLYMARKET_DISTANCE_FROM_OPEN_THRESHOLD_PCT,
              lateWindowMaxTimeToExpiryMs: cfg.POLYMARKET_LATE_WINDOW_THRESHOLD_MS,
              maxClobStalenessMs: cfg.POLYMARKET_MAX_BOOK_STALENESS_MS,
            },
            nowMs: systemClock.nowMs(),
          });
          for (const c of candidates) {
            eventRepo.insert(run.runId, c);
            lifecycleTracker.recordObservation(run.runId, c);
            candidatesEmitted++;
          }
        }

        lifecycleTracker.closeIdleLifecycles();

        log.info(
          {
            iter,
            markets: allMarkets.length,
            candidates: candidatesEmitted,
            elapsedMs: systemClock.nowMs() - loopStart,
          },
          'poly cycle complete',
        );

        const elapsed = systemClock.nowMs() - loopStart;
        const sleep = Math.max(0, cfg.POLYMARKET_SCAN_INTERVAL_MS - elapsed);
        if (sleep > 0) await systemClock.sleep(sleep);
      }
      endRun(run, 'completed');
      runs.finalize(run);
      return run;
    } catch (err) {
      log.error({ err }, 'polymarket scan loop crashed');
      endRun(run, 'failed', (err as Error).message);
      runs.finalize(run);
      throw err;
    }
  }
}
