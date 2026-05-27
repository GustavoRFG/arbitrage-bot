/**
 * Phase 2.6 — Actionability score.
 *
 * Transparent, non-ML, rule-based score that combines a few normalised
 * signals from comparison + Observatory data. The component values are kept
 * so the UI can show *why* a regime / symbol / route scores high or low —
 * this is a research heuristic, not a financial prediction.
 *
 * Formula:
 *   actionabilityScore =
 *     0.30 * normalizedPositivePnL
 *   + 0.20 * tradableRatio
 *   + 0.20 * persistenceScore
 *   + 0.15 * latencyRobustness
 *   + 0.15 * inventoryReadiness
 *
 * All inputs clipped to [0, 1] so the final score is also [0, 1].
 */

import type { ComparisonScenarioRow, ComparisonMatrix } from './queries/comparison';

const WEIGHTS = {
  positivePnL: 0.3,
  tradableRatio: 0.2,
  persistence: 0.2,
  latencyRobustness: 0.15,
  inventoryReadiness: 0.15,
} as const;

export interface ActionabilityInputs {
  /** Best total net PnL observed across the comparison's preset×latency grid. */
  bestTotalNetProfitQuote: number;
  /** Reference scale used to normalise PnL into [0, 1]. Defaults to $50. */
  pnlReferenceQuote?: number;
  /** Estimates that passed depth + thresholds / total estimates considered. */
  tradableRatio: number;
  /** Persistence proxy from lifecycles (multi-obs ratio, etc.). */
  persistenceScore: number;
  /** PnL at the highest latency / PnL at zero latency. */
  pnlAtMaxLatencyQuote: number;
  pnlAtZeroLatencyQuote: number;
  /** Executed PnL vs executed + missed-inventory PnL. */
  executedPnLQuote: number;
  missedInventoryPnLQuote: number;
}

export interface ActionabilityComponents {
  positivePnL: number;
  tradableRatio: number;
  persistence: number;
  latencyRobustness: number;
  inventoryReadiness: number;
}

export interface ActionabilityResult {
  total: number;
  components: ActionabilityComponents;
  weights: typeof WEIGHTS;
  notes: string[];
}

function clip01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function computeActionability(inputs: ActionabilityInputs): ActionabilityResult {
  const notes: string[] = [];
  const pnlRef = inputs.pnlReferenceQuote ?? 50;
  const normalizedPositivePnL = clip01(Math.max(0, inputs.bestTotalNetProfitQuote) / pnlRef);
  if (inputs.bestTotalNetProfitQuote <= 0) {
    notes.push('No positive paper PnL was observed across the comparison grid.');
  }

  const tradableRatio = clip01(inputs.tradableRatio);
  const persistenceScore = clip01(inputs.persistenceScore);

  const latencyRobustness =
    inputs.pnlAtZeroLatencyQuote > 0
      ? clip01(inputs.pnlAtMaxLatencyQuote / inputs.pnlAtZeroLatencyQuote)
      : 0;
  if (latencyRobustness < 0.5 && inputs.pnlAtZeroLatencyQuote > 0) {
    notes.push('Latency degrades PnL by more than 50% at the worst-case scenario.');
  }

  const inventoryDenom = inputs.executedPnLQuote + inputs.missedInventoryPnLQuote;
  const inventoryReadiness = inventoryDenom > 0 ? clip01(inputs.executedPnLQuote / inventoryDenom) : 0;
  if (inputs.missedInventoryPnLQuote > inputs.executedPnLQuote && inventoryDenom > 0) {
    notes.push('Missed inventory PnL exceeds executed PnL — capital allocation is the binding constraint.');
  }

  const components: ActionabilityComponents = {
    positivePnL: normalizedPositivePnL,
    tradableRatio,
    persistence: persistenceScore,
    latencyRobustness,
    inventoryReadiness,
  };

  const total =
    WEIGHTS.positivePnL * components.positivePnL +
    WEIGHTS.tradableRatio * components.tradableRatio +
    WEIGHTS.persistence * components.persistence +
    WEIGHTS.latencyRobustness * components.latencyRobustness +
    WEIGHTS.inventoryReadiness * components.inventoryReadiness;

  return {
    total: clip01(total),
    components,
    weights: WEIGHTS,
    notes,
  };
}

export interface MatrixActionabilityInputs {
  matrix: ComparisonMatrix;
  scenarios: ComparisonScenarioRow[];
  tradableRatio: number;
  persistenceScore: number;
  pnlReferenceQuote?: number;
}

/**
 * Convenience: given the comparison matrix + scenarios, pick the best preset,
 * derive latency robustness from min/max latency cells, and aggregate the
 * inventory-bottleneck missed PnL.
 */
export function computeActionabilityFromMatrix(
  inputs: MatrixActionabilityInputs,
): ActionabilityResult {
  const { matrix, scenarios, tradableRatio, persistenceScore } = inputs;
  if (matrix.cells.length === 0 || scenarios.length === 0) {
    return computeActionability({
      bestTotalNetProfitQuote: 0,
      tradableRatio,
      persistenceScore,
      pnlAtMaxLatencyQuote: 0,
      pnlAtZeroLatencyQuote: 0,
      executedPnLQuote: 0,
      missedInventoryPnLQuote: 0,
      ...(inputs.pnlReferenceQuote !== undefined ? { pnlReferenceQuote: inputs.pnlReferenceQuote } : {}),
    });
  }

  // Best cell by PnL.
  const best = matrix.cells.reduce((a, b) =>
    b.totalNetProfitQuote > a.totalNetProfitQuote ? b : a,
  );

  // Latency robustness: compare best-preset PnL at min vs max latency.
  const sameBestPreset = matrix.cells.filter((c) => c.presetName === best.presetName);
  const minLatencyCell = sameBestPreset.reduce((a, b) => (b.latencyMs < a.latencyMs ? b : a));
  const maxLatencyCell = sameBestPreset.reduce((a, b) => (b.latencyMs > a.latencyMs ? b : a));

  // Inventory readiness: executed PnL across all cells vs missed inventory PnL.
  let executedPnL = 0;
  let missedInventoryPnL = 0;
  for (const s of scenarios) {
    executedPnL += Math.max(0, s.totalNetProfitQuote);
    try {
      const parsed = JSON.parse(s.missedProfitByReasonJson) as Record<string, number>;
      missedInventoryPnL +=
        (parsed.insufficient_base_inventory ?? 0) +
        (parsed.insufficient_quote_inventory ?? 0);
    } catch {
      /* noop */
    }
  }

  return computeActionability({
    bestTotalNetProfitQuote: best.totalNetProfitQuote,
    tradableRatio,
    persistenceScore,
    pnlAtMaxLatencyQuote: Math.max(0, maxLatencyCell.totalNetProfitQuote),
    pnlAtZeroLatencyQuote: Math.max(0, minLatencyCell.totalNetProfitQuote),
    executedPnLQuote: executedPnL,
    missedInventoryPnLQuote: missedInventoryPnL,
    ...(inputs.pnlReferenceQuote !== undefined ? { pnlReferenceQuote: inputs.pnlReferenceQuote } : {}),
  });
}
