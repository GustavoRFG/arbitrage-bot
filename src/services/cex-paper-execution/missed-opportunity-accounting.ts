/**
 * Phase 2.1 — missed-opportunity accounting.
 *
 * The base simulator records *which* rejections happened and counts them by
 * reason. This module computes the *value* of those missed opportunities —
 * how much net profit (in quote units) the framework rejected because of
 * each cause, and which route/symbol/run lost the most.
 *
 * Important: the value attributed to a rejection is the same `net_profit_quote`
 * the Observatory already computed for the best estimate on that lifecycle.
 * We never invent a price or a depth — the same estimate that the simulator
 * declined to trade is the one whose value we tally.
 */

import { passesPolicyThresholds } from './paper-simulation-policy.js';

import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
  PaperTradeRejection,
  PolicyConfig,
  RejectionReason,
} from './paper-trade-types.js';

export interface MissedEntry {
  lifecycleId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  detectedAtMs: number;
  reason: RejectionReason;
  /** Best-case net profit on the lifecycle's surviving (or first) estimate, in quote. */
  estimatedMissedProfitQuote: number;
  detail?: string;
}

export interface MissedOpportunityReport {
  total: number;
  totalMissedProfitQuote: number;
  missedByReason: Record<RejectionReason, number>;
  missedProfitByReason: Record<RejectionReason, number>;
  entries: MissedEntry[];
}

const REJECTION_REASONS: RejectionReason[] = [
  'no_eligible_estimate',
  'below_threshold',
  'latency_expired',
  'insufficient_quote_inventory',
  'insufficient_base_inventory',
  'lifecycle_too_short_for_latency',
];

function emptyReasonCounter(): Record<RejectionReason, number> {
  const out = {} as Record<RejectionReason, number>;
  for (const r of REJECTION_REASONS) out[r] = 0;
  return out;
}

/**
 * Estimate the missed profit attributable to one rejection.
 *
 * Rules:
 *   - lifecycle_too_short_for_latency / latency_expired: take the highest
 *     net_profit_quote across the lifecycle's estimates (this is what the
 *     trader would have captured with zero latency).
 *   - insufficient_quote_inventory / insufficient_base_inventory: take the
 *     net_profit_quote of the best policy-passing estimate; this is the
 *     trade the simulator wanted to execute but could not afford.
 *   - below_threshold: take the maximum net_profit_quote across the
 *     lifecycle even if it failed thresholds — this is the unrealised value
 *     the simulator left on the table because of policy gates. (May be zero
 *     or negative; only positive values move the missed-profit total.)
 *   - no_eligible_estimate: zero (there is nothing to estimate from).
 *
 * Negative best-profits are coerced to zero — "missed profit" can never be
 * negative; a negative best estimate just means the trade would have lost
 * money and rejecting it was correct.
 */
export function estimateMissedProfit(
  lc: LifecycleWithEstimates,
  reason: RejectionReason,
  policy: PolicyConfig,
): number {
  if (lc.estimates.length === 0) return 0;
  if (reason === 'no_eligible_estimate') return 0;

  let best: number;
  if (reason === 'insufficient_quote_inventory' || reason === 'insufficient_base_inventory') {
    best = bestProfit(lc.estimates.filter((e) => passesPolicyThresholds(e, policy).passes));
  } else if (reason === 'below_threshold') {
    best = bestProfit(lc.estimates);
  } else {
    // latency_expired / lifecycle_too_short_for_latency — best across all.
    best = bestProfit(lc.estimates);
  }
  return Math.max(0, best);
}

function bestProfit(estimates: CandidateEstimateRow[]): number {
  if (estimates.length === 0) return 0;
  let max = estimates[0]!.netProfitQuote;
  for (const e of estimates) if (e.netProfitQuote > max) max = e.netProfitQuote;
  return max;
}

/**
 * Build a `MissedOpportunityReport` from the rejection list emitted by the
 * simulator plus the full lifecycle list (needed to look up the best estimate
 * for each rejection). The mapping uses `lifecycleId`.
 */
export function buildMissedOpportunityReport(
  rejections: PaperTradeRejection[],
  lifecycles: LifecycleWithEstimates[],
  policy: PolicyConfig,
): MissedOpportunityReport {
  const byId = new Map<number, LifecycleWithEstimates>();
  for (const lc of lifecycles) byId.set(lc.lifecycleId, lc);

  const entries: MissedEntry[] = [];
  const missedByReason = emptyReasonCounter();
  const missedProfitByReason = emptyReasonCounter();
  let totalMissedProfit = 0;

  for (const rej of rejections) {
    const lc = byId.get(rej.lifecycleId);
    const missed = lc ? estimateMissedProfit(lc, rej.reason, policy) : 0;
    missedByReason[rej.reason] += 1;
    missedProfitByReason[rej.reason] += missed;
    totalMissedProfit += missed;
    const entry: MissedEntry = {
      lifecycleId: rej.lifecycleId,
      symbol: rej.symbol,
      buyVenue: rej.buyVenue,
      sellVenue: rej.sellVenue,
      detectedAtMs: rej.detectedAtMs,
      reason: rej.reason,
      estimatedMissedProfitQuote: missed,
    };
    if (rej.detail !== undefined) entry.detail = rej.detail;
    entries.push(entry);
  }

  return {
    total: rejections.length,
    totalMissedProfitQuote: totalMissedProfit,
    missedByReason,
    missedProfitByReason,
    entries,
  };
}
