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
import { selectBestEstimate } from './trade-selection.js';

import type { FeeResolver } from '../cex-arbitrage/fee-resolver.js';

export interface SimulatorInput {
  simulationRunId: string;
  sourceScannerRunId: string;
  policy: PolicyConfig;
  latencyMs: number;
  lifecycles: LifecycleWithEstimates[];
  initialPortfolio: PaperPortfolioJson;
  feeResolver: FeeResolver;
  /** Wall-clock at simulation invocation; persisted as `created_at`. */
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
  for (const reason of REJECTION_REASONS) out[reason] = 0;
  return out;
}

/**
 * Replay all eligible lifecycles against a single latency scenario and emit a
 * `PaperSimulationResult`. The simulator is intentionally pure with respect to
 * the database: it accepts already-loaded lifecycles and returns an in-memory
 * result. Persistence is the orchestrator's responsibility.
 *
 * Strategies:
 *   - once_per_lifecycle (default): at most one paper trade per lifecycle, on
 *     the latency-surviving estimate selected by `policy.selectionMode`.
 *   - cooldown_reentry: walk every surviving estimate in detected_at order; if
 *     the previous trade on this lifecycle is older than `reentryCooldownMs`
 *     and inventory still clears, execute again.
 */
export class PaperSimulator {
  constructor(private readonly input: SimulatorInput) {}

  run(): PaperSimulationResult {
    const { policy, lifecycles, latencyMs } = this.input;
    const ledger = new PortfolioLedger(this.input.initialPortfolio);
    const trades: PaperArbitrageTrade[] = [];
    const rejections: PaperTradeRejection[] = [];
    const rejectionsByReason = emptyRejectionCounter();
    let eligibleLifecycles = 0;

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

      if (policy.strategy === 'cooldown_reentry') {
        this.runCooldownReentry(
          lc,
          replay.survivingEstimates,
          policy,
          ledger,
          trades,
          rejections,
          rejectionsByReason,
        );
      } else {
        this.runOnce(
          lc,
          replay.survivingEstimates,
          replay.executedAtMs ?? lc.firstSeenAtMs,
          policy,
          ledger,
          trades,
          rejections,
          rejectionsByReason,
        );
      }
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

  private runOnce(
    lc: LifecycleWithEstimates,
    surviving: CandidateEstimateRow[],
    executedAtMs: number,
    policy: PolicyConfig,
    ledger: PortfolioLedger,
    trades: PaperArbitrageTrade[],
    rejections: PaperTradeRejection[],
    rejectionsByReason: Record<RejectionReason, number>,
  ): void {
    const best = selectBestEstimate(surviving, policy);
    if (!best) {
      this.recordRejection(rejections, rejectionsByReason, lc, 'below_threshold');
      return;
    }
    this.tryExecute(lc, best, executedAtMs, policy, ledger, trades, rejections, rejectionsByReason);
  }

  private runCooldownReentry(
    lc: LifecycleWithEstimates,
    surviving: CandidateEstimateRow[],
    policy: PolicyConfig,
    ledger: PortfolioLedger,
    trades: PaperArbitrageTrade[],
    rejections: PaperTradeRejection[],
    rejectionsByReason: Record<RejectionReason, number>,
  ): void {
    const cooldown = policy.reentryCooldownMs ?? 0;
    let lastExecutedAt = Number.NEGATIVE_INFINITY;
    let executedAny = false;

    for (const est of surviving) {
      if (lastExecutedAt !== Number.NEGATIVE_INFINITY && est.detectedAtMs - lastExecutedAt < cooldown) {
        continue;
      }
      const check = passesPolicyThresholds(est, policy);
      if (!check.passes) continue;

      const ok = this.tryExecute(
        lc,
        est,
        est.detectedAtMs,
        policy,
        ledger,
        trades,
        rejections,
        rejectionsByReason,
      );
      if (ok) {
        lastExecutedAt = est.detectedAtMs;
        executedAny = true;
      }
    }

    if (!executedAny) {
      const anyPasses = surviving.some((e) => passesPolicyThresholds(e, policy).passes);
      if (!anyPasses) {
        this.recordRejection(rejections, rejectionsByReason, lc, 'below_threshold');
      }
    }
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
        `need ${requiredQuote.toFixed(4)} ${quote} on ${lc.buyVenue}, ` +
          `have ${ledger.getBalance(lc.buyVenue, quote).toFixed(4)}`,
      );
      return false;
    }
    if (!ledger.canAfford(lc.sellVenue, base, baseQty)) {
      this.recordRejection(
        rejections,
        rejectionsByReason,
        lc,
        'insufficient_base_inventory',
        `need ${baseQty.toFixed(4)} ${base} on ${lc.sellVenue}, ` +
          `have ${ledger.getBalance(lc.sellVenue, base).toFixed(4)}`,
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
    const rejection: PaperTradeRejection = {
      lifecycleId: lc.lifecycleId,
      symbol: lc.symbol,
      buyVenue: lc.buyVenue,
      sellVenue: lc.sellVenue,
      detectedAtMs,
      reason,
    };
    if (detail !== undefined) rejection.detail = detail;
    rejections.push(rejection);
    rejectionsByReason[reason] += 1;
  }
}

export interface AutoPrefundInput {
  lifecycles: LifecycleWithEstimates[];
  quotePerBuyVenue: number;
  baseNotionalPerSellVenue: number;
}

/**
 * Mode A auto-prefund.
 *
 * Reads every (symbol, buyVenue, sellVenue) it sees in the lifecycle list,
 * gives the buy venue `quotePerBuyVenue` units of the symbol's quote currency,
 * and gives the sell venue base-asset inventory worth `baseNotionalPerSellVenue`
 * of that quote currency at the first observed avg_buy_price for that symbol.
 *
 * That mid-price proxy is deterministic (always the first estimate for that
 * symbol/lifecycle ordering) so tests are reproducible. If a symbol has no
 * estimates, the sell-side base allocation is skipped — there is no
 * conversion price to use.
 */
export function buildAutoPrefundedPortfolio(input: AutoPrefundInput): PaperPortfolioJson {
  const portfolio: PaperPortfolioJson = {};
  const seedBalance = (venue: string, asset: string, amount: number) => {
    if (amount <= 0) return;
    const inner = portfolio[venue] ?? {};
    inner[asset] = Math.max(inner[asset] ?? 0, amount);
    portfolio[venue] = inner;
  };

  const firstPriceBySymbol = new Map<string, number>();
  for (const lc of input.lifecycles) {
    if (firstPriceBySymbol.has(lc.symbol)) continue;
    const firstEst = lc.estimates[0];
    if (firstEst) firstPriceBySymbol.set(lc.symbol, firstEst.avgBuyPrice);
  }

  for (const lc of input.lifecycles) {
    const { base, quote } = parseSymbol(lc.symbol);
    seedBalance(lc.buyVenue, quote, input.quotePerBuyVenue);
    const price = firstPriceBySymbol.get(lc.symbol);
    if (price && price > 0) {
      const baseQty = input.baseNotionalPerSellVenue / price;
      seedBalance(lc.sellVenue, base, baseQty);
    }
  }
  return portfolio;
}
