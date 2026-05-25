/**
 * Phase 2 — Prefunded Paper Execution Simulator
 *
 * Types shared across the simulator. These are purely structural; the simulator
 * itself is implemented as small focused modules (policy, ledger, latency,
 * selection, orchestrator, report).
 */

export type SelectionMode =
  | 'best_profit'
  | 'largest_notional'
  | 'fifo'
  | 'best_profit_first'
  | 'best_spread_first'
  | 'inventory_efficiency';

export type SimulationStrategy =
  | 'once_per_lifecycle'
  | 'cooldown_reentry';

export type RejectionReason =
  | 'no_eligible_estimate'
  | 'below_threshold'
  | 'latency_expired'
  | 'insufficient_quote_inventory'
  | 'insufficient_base_inventory'
  | 'lifecycle_too_short_for_latency';

export interface CandidateEstimateRow {
  estimateId: number;
  candidateId: number;
  detectedAtMs: number;
  targetNotionalQuote: number;
  executableBuyNotional: number;
  executableSellNotional: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  feesQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  supportedByDepth: boolean;
  tradablePrefunded: boolean;
}

export interface LifecycleWithEstimates {
  lifecycleId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs: number | null;
  durationMs: number;
  observationCount: number;
  estimates: CandidateEstimateRow[];
}

export interface PolicyConfig {
  policyName: string;
  strategy: SimulationStrategy;
  selectionMode: SelectionMode;
  minNetProfitQuote: number;
  minNetSpreadPct: number;
  maxTargetNotionalQuote: number;
  reentryCooldownMs?: number;
}

export interface SymbolPair {
  base: string;
  quote: string;
}

export interface PaperPortfolioJson {
  [venue: string]: { [asset: string]: number };
}

export interface PaperArbitrageTrade {
  lifecycleId: number;
  candidateId: number;
  estimateId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  detectedAtMs: number;
  executedAtMs: number;
  latencyMs: number;
  targetNotionalQuote: number;
  executableBuyNotional: number;
  executableSellNotional: number;
  baseQty: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  feesQuote: number;
  netProfitQuote: number;
  netSpreadPct: number;
  buyQuoteDelta: number;
  buyBaseDelta: number;
  sellBaseDelta: number;
  sellQuoteDelta: number;
  policyName: string;
}

export interface PaperTradeRejection {
  lifecycleId: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  detectedAtMs: number;
  reason: RejectionReason;
  detail?: string;
}

export interface PaperSimulationResult {
  simulationRunId: string;
  sourceScannerRunId: string;
  createdAtMs: number;
  policy: PolicyConfig;
  latencyMs: number;
  initialPortfolio: PaperPortfolioJson;
  finalPortfolio: PaperPortfolioJson;
  eligibleLifecycles: number;
  trades: PaperArbitrageTrade[];
  rejections: PaperTradeRejection[];
  rejectionsByReason: Record<RejectionReason, number>;
  totalNetProfitQuote: number;
  symbolsFilter?: string[];
  routesFilter?: Array<[string, string]>;
}

/** Parse "PYTH/USDT" into { base, quote }. Throws on malformed input. */
export function parseSymbol(symbol: string): SymbolPair {
  const idx = symbol.indexOf('/');
  if (idx <= 0 || idx === symbol.length - 1) {
    throw new Error(`Invalid symbol: ${symbol} (expected BASE/QUOTE)`);
  }
  return {
    base: symbol.slice(0, idx),
    quote: symbol.slice(idx + 1),
  };
}
