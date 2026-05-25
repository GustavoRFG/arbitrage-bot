import type {
  CandidateEstimateRow,
  PolicyConfig,
  RejectionReason,
  SelectionMode,
  SimulationStrategy,
} from './paper-trade-types.js';

export interface ThresholdCheckResult {
  passes: boolean;
  reason?: RejectionReason;
}

/**
 * The single eligibility predicate used everywhere in the simulator. An
 * estimate is eligible when the Observatory itself flagged it as supported by
 * depth + tradable under prefunded assumptions AND it clears the (policy-
 * configurable) profit / spread / max-notional thresholds.
 *
 * Inventory checks are intentionally NOT here — they belong to the ledger
 * because they need portfolio state, while this predicate is purely on the
 * estimate row.
 */
export function passesPolicyThresholds(
  est: CandidateEstimateRow,
  policy: PolicyConfig,
): ThresholdCheckResult {
  if (!est.tradablePrefunded || !est.supportedByDepth) {
    return { passes: false, reason: 'below_threshold' };
  }
  if (est.targetNotionalQuote > policy.maxTargetNotionalQuote) {
    return { passes: false, reason: 'below_threshold' };
  }
  if (est.netProfitQuote < policy.minNetProfitQuote) {
    return { passes: false, reason: 'below_threshold' };
  }
  if (est.netSpreadPct < policy.minNetSpreadPct) {
    return { passes: false, reason: 'below_threshold' };
  }
  return { passes: true };
}

const VALID_STRATEGIES: ReadonlySet<SimulationStrategy> = new Set([
  'once_per_lifecycle',
  'cooldown_reentry',
]);

const VALID_SELECTION_MODES: ReadonlySet<SelectionMode> = new Set([
  'best_profit',
  'largest_notional',
  'fifo',
  'best_profit_first',
  'best_spread_first',
  'inventory_efficiency',
]);

export function parseStrategy(raw: string | undefined): SimulationStrategy {
  if (!raw) return 'once_per_lifecycle';
  const normalised = raw.trim();
  if (!VALID_STRATEGIES.has(normalised as SimulationStrategy)) {
    throw new Error(
      `Unknown --policy ${raw} (supported: once_per_lifecycle, cooldown_reentry)`,
    );
  }
  return normalised as SimulationStrategy;
}

export function parseSelectionMode(raw: string | undefined): SelectionMode {
  if (!raw) return 'best_profit';
  const normalised = raw.trim();
  if (!VALID_SELECTION_MODES.has(normalised as SelectionMode)) {
    throw new Error(
      `Unknown --selection ${raw} (supported: best_profit, largest_notional, fifo, best_profit_first, best_spread_first, inventory_efficiency)`,
    );
  }
  return normalised as SelectionMode;
}

export function buildPolicy(args: {
  strategy: SimulationStrategy;
  selectionMode: SelectionMode;
  minNetProfitQuote: number;
  minNetSpreadPct: number;
  maxTargetNotionalQuote: number;
  reentryCooldownMs?: number;
}): PolicyConfig {
  const policy: PolicyConfig = {
    policyName: args.strategy,
    strategy: args.strategy,
    selectionMode: args.selectionMode,
    minNetProfitQuote: args.minNetProfitQuote,
    minNetSpreadPct: args.minNetSpreadPct,
    maxTargetNotionalQuote: args.maxTargetNotionalQuote,
  };
  if (args.reentryCooldownMs !== undefined) {
    policy.reentryCooldownMs = args.reentryCooldownMs;
  }
  return policy;
}
