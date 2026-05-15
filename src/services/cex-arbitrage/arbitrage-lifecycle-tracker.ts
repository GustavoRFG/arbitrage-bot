import { cexArbitrageKey } from '../../core/types/event.js';

import type { CexArbitrageCandidate } from './arbitrage-detector.js';
import type { ArbitrageLifecycleRepository } from '../../persistence/repositories/arbitrage-lifecycle-repository.js';

/**
 * Translates a stream of point-in-time candidates into open lifecycles in the
 * database, and closes lifecycles whose latest sighting is older than
 * `closeGraceMs`.
 */
export class ArbitrageLifecycleTracker {
  constructor(
    private readonly repo: ArbitrageLifecycleRepository,
    private readonly closeGraceMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  recordObservation(runId: string, c: CexArbitrageCandidate): number {
    const eventKey = cexArbitrageKey(c.symbol, c.buyExchange, c.sellExchange);
    const bestNetProfit = c.estimates.reduce(
      (m, e) => (e.netProfitQuote > m ? e.netProfitQuote : m),
      0,
    );
    const bestSupportedNotional = c.estimates.reduce(
      (m, e) => (e.supportedByDepth && e.targetNotionalQuote > m ? e.targetNotionalQuote : m),
      0,
    );
    return this.repo.upsertOpen({
      runId,
      eventKey,
      symbol: c.symbol,
      buyExchange: c.buyExchange,
      sellExchange: c.sellExchange,
      observedAtMs: c.detectedAtMs,
      grossSpreadPct: c.grossSpreadPct,
      approxNetSpreadPct: c.approxNetSpreadPct,
      netProfitQuote: bestNetProfit,
      supportedNotionalQuote: bestSupportedNotional,
    });
  }

  closeIdleLifecycles(): number {
    const cutoff = this.nowMs() - this.closeGraceMs;
    return this.repo.closeStale(cutoff, this.nowMs());
  }
}
