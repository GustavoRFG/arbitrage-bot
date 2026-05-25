/**
 * Phase 2.1 — multi-route inventory contention.
 *
 * The base `PaperSimulator` iterates lifecycles in insertion order and a
 * lifecycle that exhausts a sell-venue base asset blocks later lifecycles
 * on the *same* (sell_venue, base) silently — but only because they happen
 * to come later in the loop. That is the right model for a single-route
 * stress test but not for real intra-venue capital contention, where many
 * candidate trades arrive interleaved in wall-clock time and compete for
 * one inventory pool.
 *
 * This simulator replays *all* surviving estimates from *all* lifecycles in
 * a single global `detected_at` order, applies them to one shared ledger,
 * and uses the configured selection mode as a *priority key* (not as a
 * per-lifecycle picker). When two estimates target the same (sell_venue,
 * base) within the same simulated tick, the policy decides which one gets
 * the inventory first; the other is rejected as
 * `insufficient_base_inventory` (or `insufficient_quote_inventory`).
 *
 * The output shape is identical to `PaperSimulationResult` so it flows
 * through the same persistence + report pipeline. The base simulator is not
 * touched — this is a separate code path callers opt into.
 */

import { replayWithLatency } from './latency-replay.js';
import { passesPolicyThresholds } from './paper-simulation-policy.js';
import {
  parseSymbol,
  type CandidateEstimateRow,
  type LifecycleWithEstimates,
  type PaperArbitrageTrade,
  type PaperPortfolioJson,
  type PaperSimulationResult,
  type PaperTradeRejection,
  type PolicyConfig,
  type RejectionReason,
} from './paper-trade-types.js';
import { PortfolioLedger } from './portfolio-ledger.js';
import { efficiency } from './trade-selection.js';

import type { FeeResolver } from '../cex-arbitrage/fee-resolver.js';

export interface MultiRouteSimulatorInput {
  simulationRunId: string;
  sourceScannerRunId: string;
  policy: PolicyConfig;
  latencyMs: number;
  lifecycles: LifecycleWithEstimates[];
  initialPortfolio: PaperPortfolioJson;
  feeResolver: FeeResolver;
  createdAtMs: number;
  symbolsFilter?: string[];
  routesFilter?: Array<[string, string]>;
}

const REJECTION_REASONS: RejectionReason[] = [
  'no_eligible_estimate',
  'below_threshold',
  'latency_expired',
  'insufficient_quote_inventory',
  'insufficient_base_inventory',
  'lifecycle_too_short_for_latency',
];

function emptyRejectionCounter(): Record<RejectionReason, number> {
  const out = {} as Record<RejectionReason, number>;
  for (const r of REJECTION_REASONS) out[r] = 0;
  return out;
}

interface CandidateEvent {
  lc: LifecycleWithEstimates;
  est: CandidateEstimateRow;
  detectedAtMs: number;
}

/**
 * Multi-route contention simulator. Once-per-lifecycle: every lifecycle gets
 * at most one trade attempt, on the first estimate that survives latency and
 * passes policy thresholds; the priority ordering across lifecycles is given
 * by the policy's `selectionMode`.
 */
export class MultiRouteContentionSimulator {
  constructor(private readonly input: MultiRouteSimulatorInput) {}

  run(): PaperSimulationResult {
    const { policy, lifecycles, latencyMs } = this.input;
    const ledger = new PortfolioLedger(this.input.initialPortfolio);
    const trades: PaperArbitrageTrade[] = [];
    const rejections: PaperTradeRejection[] = [];
    const rejectionsByReason = emptyRejectionCounter();
    let eligibleLifecycles = 0;

    // Per-lifecycle pre-screen: select one candidate event per lifecycle.
    const events: CandidateEvent[] = [];
    for (const lc of lifecycles) {
      if (lc.estimates.length === 0) continue;
      eligibleLifecycles += 1;

      const replay = replayWithLatency(lc, latencyMs);
      if (replay.expiredBeforeLatency) {
        this.recordRejection(rejections, rejectionsByReason, lc, 'lifecycle_too_short_for_latency');
        continue;
      }
      if (replay.survivingEstimates.length === 0) {
        this.recordRejection(rejections, rejectionsByReason, lc, 'latency_expired');
        continue;
      }
      // Pick the best policy-passing surviving estimate for this lifecycle.
      const eligible = replay.survivingEstimates.filter((e) => passesPolicyThresholds(e, policy).passes);
      if (eligible.length === 0) {
        this.recordRejection(rejections, rejectionsByReason, lc, 'below_threshold');
        continue;
      }
      // Within one lifecycle, default to the earliest surviving eligible
      // estimate — the trader reacts as soon as a profitable signal exists.
      eligible.sort((a, b) => a.detectedAtMs - b.detectedAtMs || a.estimateId - b.estimateId);
      events.push({ lc, est: eligible[0]!, detectedAtMs: eligible[0]!.detectedAtMs });
    }

    // Global priority ordering across lifecycles.
    events.sort(eventPriorityComparator(policy.selectionMode));

    for (const ev of events) {
      this.tryExecute(ev.lc, ev.est, ev.detectedAtMs, policy, ledger, trades, rejections, rejectionsByReason);
    }

    const totalNetProfit = trades.reduce((acc, t) => acc + t.netProfitQuote, 0);
    const result: PaperSimulationResult = {
      simulationRunId: this.input.simulationRunId,
      sourceScannerRunId: this.input.sourceScannerRunId,
      createdAtMs: this.input.createdAtMs,
      policy,
      latencyMs,
      initialPortfolio: this.input.initialPortfolio,
      finalPortfolio: ledger.snapshot(),
      eligibleLifecycles,
      trades,
      rejections,
      rejectionsByReason,
      totalNetProfitQuote: totalNetProfit,
    };
    if (this.input.symbolsFilter && this.input.symbolsFilter.length > 0) {
      result.symbolsFilter = this.input.symbolsFilter.slice();
    }
    if (this.input.routesFilter && this.input.routesFilter.length > 0) {
      result.routesFilter = this.input.routesFilter.map((r) => [...r] as [string, string]);
    }
    return result;
  }

  private tryExecute(
    lc: LifecycleWithEstimates,
    est: CandidateEstimateRow,
    executedAtMs: number,
    policy: PolicyConfig,
    ledger: PortfolioLedger,
    trades: PaperArbitrageTrade[],
    rejections: PaperTradeRejection[],
    rejectionsByReason: Record<RejectionReason, number>,
  ): boolean {
    const { base, quote } = parseSymbol(lc.symbol);
    const baseQty = est.executableBuyNotional / est.avgBuyPrice;
    const buyFee = est.executableBuyNotional * this.input.feeResolver.takerFeeRate(lc.buyVenue);
    const sellFee = est.executableSellNotional * this.input.feeResolver.takerFeeRate(lc.sellVenue);

    const buyQuoteDelta = -(est.executableBuyNotional + buyFee);
    const buyBaseDelta = baseQty;
    const sellBaseDelta = -baseQty;
    const sellQuoteDelta = est.executableSellNotional - sellFee;

    const requiredQuote = est.executableBuyNotional + buyFee;
    if (!ledger.canAfford(lc.buyVenue, quote, requiredQuote)) {
      this.recordRejection(
        rejections,
        rejectionsByReason,
        lc,
        'insufficient_quote_inventory',
        `need ${requiredQuote.toFixed(4)} ${quote} on ${lc.buyVenue}, have ${ledger
          .getBalance(lc.buyVenue, quote)
          .toFixed(4)}`,
      );
      return false;
    }
    if (!ledger.canAfford(lc.sellVenue, base, baseQty)) {
      this.recordRejection(
        rejections,
        rejectionsByReason,
        lc,
        'insufficient_base_inventory',
        `need ${baseQty.toFixed(4)} ${base} on ${lc.sellVenue}, have ${ledger
          .getBalance(lc.sellVenue, base)
          .toFixed(4)}`,
      );
      return false;
    }

    ledger.apply([
      { venue: lc.buyVenue, asset: quote, delta: buyQuoteDelta },
      { venue: lc.buyVenue, asset: base, delta: buyBaseDelta },
      { venue: lc.sellVenue, asset: base, delta: sellBaseDelta },
      { venue: lc.sellVenue, asset: quote, delta: sellQuoteDelta },
    ]);

    trades.push({
      lifecycleId: lc.lifecycleId,
      candidateId: est.candidateId,
      estimateId: est.estimateId,
      symbol: lc.symbol,
      buyVenue: lc.buyVenue,
      sellVenue: lc.sellVenue,
      detectedAtMs: est.detectedAtMs,
      executedAtMs,
      latencyMs: this.input.latencyMs,
      targetNotionalQuote: est.targetNotionalQuote,
      executableBuyNotional: est.executableBuyNotional,
      executableSellNotional: est.executableSellNotional,
      baseQty,
      avgBuyPrice: est.avgBuyPrice,
      avgSellPrice: est.avgSellPrice,
      feesQuote: buyFee + sellFee,
      netProfitQuote: est.netProfitQuote,
      netSpreadPct: est.netSpreadPct,
      buyQuoteDelta,
      buyBaseDelta,
      sellBaseDelta,
      sellQuoteDelta,
      policyName: policy.policyName,
    });
    return true;
  }

  private recordRejection(
    rejections: PaperTradeRejection[],
    rejectionsByReason: Record<RejectionReason, number>,
    lc: LifecycleWithEstimates,
    reason: RejectionReason,
    detail?: string,
  ): void {
    const detectedAtMs = lc.estimates[0]?.detectedAtMs ?? lc.firstSeenAtMs;
    const rej: PaperTradeRejection = {
      lifecycleId: lc.lifecycleId,
      symbol: lc.symbol,
      buyVenue: lc.buyVenue,
      sellVenue: lc.sellVenue,
      detectedAtMs,
      reason,
    };
    if (detail !== undefined) rej.detail = detail;
    rejections.push(rej);
    rejectionsByReason[reason] += 1;
  }
}

/**
 * Priority comparator across lifecycles. The `fifo` selection mode keeps
 * detected_at order (the natural fair queue). The other modes sort by their
 * usual quality metric so the highest-priority contender consumes inventory
 * first; detected_at + estimateId are always the final tie-breakers so the
 * order is deterministic across machines.
 */
function eventPriorityComparator(mode: PolicyConfig['selectionMode']): (a: CandidateEvent, b: CandidateEvent) => number {
  if (mode === 'fifo') {
    return (a, b) => {
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.est.estimateId - b.est.estimateId;
    };
  }
  if (mode === 'largest_notional') {
    return (a, b) => {
      if (a.est.targetNotionalQuote !== b.est.targetNotionalQuote) {
        return b.est.targetNotionalQuote - a.est.targetNotionalQuote;
      }
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.est.estimateId - b.est.estimateId;
    };
  }
  if (mode === 'best_spread_first') {
    return (a, b) => {
      if (a.est.netSpreadPct !== b.est.netSpreadPct) return b.est.netSpreadPct - a.est.netSpreadPct;
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.est.estimateId - b.est.estimateId;
    };
  }
  if (mode === 'inventory_efficiency') {
    return (a, b) => {
      const ea = efficiency(a.est);
      const eb = efficiency(b.est);
      if (ea !== eb) return eb - ea;
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.est.estimateId - b.est.estimateId;
    };
  }
  // best_profit / best_profit_first.
  return (a, b) => {
    if (a.est.netProfitQuote !== b.est.netProfitQuote) return b.est.netProfitQuote - a.est.netProfitQuote;
    if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
    return a.est.estimateId - b.est.estimateId;
  };
}
