import { passesPolicyThresholds } from './paper-simulation-policy.js';

import type { CandidateEstimateRow, PolicyConfig } from './paper-trade-types.js';

/**
 * Pick the single estimate that the simulator should attempt to execute, out
 * of the latency-surviving candidates. Returns null if none of them pass the
 * configured thresholds (the simulator records this as a `below_threshold`
 * rejection).
 *
 * Selection mode `best_profit` (default) maximises net_profit_quote;
 * `largest_notional` picks the biggest target notional that still clears the
 * thresholds. Both fall back to deterministic tie-breaks so test fixtures
 * always pick the same row across machines.
 *
 * The max-notional cap lives on the policy itself (so it shows up in
 * `paper_simulation_runs`); estimates above the cap are filtered by
 * `passesPolicyThresholds` directly, not by this selector.
 */
export function selectBestEstimate(
  estimates: CandidateEstimateRow[],
  policy: PolicyConfig,
): CandidateEstimateRow | null {
  const eligible = estimates.filter((e) => passesPolicyThresholds(e, policy).passes);
  if (eligible.length === 0) return null;

  const sorted = eligible.slice().sort(compareByMode(policy.selectionMode));
  return sorted[0] ?? null;
}

function compareByMode(
  mode: PolicyConfig['selectionMode'],
): (a: CandidateEstimateRow, b: CandidateEstimateRow) => number {
  if (mode === 'largest_notional') {
    return (a, b) => {
      if (a.targetNotionalQuote !== b.targetNotionalQuote) {
        return b.targetNotionalQuote - a.targetNotionalQuote;
      }
      if (a.netProfitQuote !== b.netProfitQuote) {
        return b.netProfitQuote - a.netProfitQuote;
      }
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.estimateId - b.estimateId;
    };
  }
  if (mode === 'fifo') {
    // Earliest detection wins, ties broken by estimate id so the order is
    // stable across machines.
    return (a, b) => {
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.estimateId - b.estimateId;
    };
  }
  if (mode === 'best_spread_first') {
    return (a, b) => {
      if (a.netSpreadPct !== b.netSpreadPct) return b.netSpreadPct - a.netSpreadPct;
      if (a.netProfitQuote !== b.netProfitQuote) return b.netProfitQuote - a.netProfitQuote;
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.estimateId - b.estimateId;
    };
  }
  if (mode === 'inventory_efficiency') {
    // Profit per base unit consumed. Higher = more profit extracted from the
    // same base inventory, which matters when several routes contend for the
    // same sell-venue base asset.
    return (a, b) => {
      const ea = efficiency(a);
      const eb = efficiency(b);
      if (ea !== eb) return eb - ea;
      if (a.netProfitQuote !== b.netProfitQuote) return b.netProfitQuote - a.netProfitQuote;
      if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
      return a.estimateId - b.estimateId;
    };
  }
  // best_profit (default) and the back-compat alias best_profit_first.
  return (a, b) => {
    if (a.netProfitQuote !== b.netProfitQuote) return b.netProfitQuote - a.netProfitQuote;
    if (a.netSpreadPct !== b.netSpreadPct) return b.netSpreadPct - a.netSpreadPct;
    if (a.detectedAtMs !== b.detectedAtMs) return a.detectedAtMs - b.detectedAtMs;
    return a.estimateId - b.estimateId;
  };
}

/** Profit per base unit consumed; undefined-safe so it always returns a finite number. */
export function efficiency(e: CandidateEstimateRow): number {
  if (!Number.isFinite(e.avgBuyPrice) || e.avgBuyPrice <= 0) return 0;
  const baseQty = e.executableBuyNotional / e.avgBuyPrice;
  if (baseQty <= 0) return 0;
  return e.netProfitQuote / baseQty;
}
