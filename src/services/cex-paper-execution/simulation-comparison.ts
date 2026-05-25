/**
 * Phase 2.1 — simulation comparison.
 *
 * Runs the prefunded paper simulator across the cross-product of:
 *   - inventory presets (conservative, moderate, aggressive, optional custom)
 *   - latencies
 *   - optional contention mode (single-route vs multi-route shared ledger)
 *
 * and emits a single side-by-side comparison that lets a reviewer see how
 * PnL, executed trades, rejection mix, and inventory drift differ across
 * funding levels at each latency. No DB writes are performed here — the
 * caller decides whether to persist each scenario.
 *
 * The comparison never re-reads the source data; one lifecycle batch is
 * loaded by the caller and re-used across every cell of the grid.
 */

import {
  buildMissedOpportunityReport,
  type MissedOpportunityReport,
} from './missed-opportunity-accounting.js';
import {
  buildPresetPortfolio,
  type PresetSpec,
} from './inventory-presets.js';
import { MultiRouteContentionSimulator } from './multi-route-contention-simulator.js';
import {
  topExecutedTrades,
  topMissedTrades,
  topRoutesByMissedPnL,
  topRoutesByPaperPnL,
  topSymbolsByInventoryEfficiency,
  type RouteAggregate,
  type SymbolInventoryEfficiency,
  type TopExecutedTrade,
  type TopMissedTrade,
} from './paper-execution-top-reports.js';
import { PaperSimulator } from './paper-simulator.js';
import { portfolioDrift } from './portfolio-ledger.js';

import type {
  LifecycleWithEstimates,
  PaperPortfolioJson,
  PaperSimulationResult,
  PolicyConfig,
  RejectionReason,
} from './paper-trade-types.js';
import type { FeeResolver } from '../cex-arbitrage/fee-resolver.js';

export type ContentionMode = 'single_route' | 'multi_route';

export interface ComparisonCell {
  presetName: string;
  presetLabel: string;
  latencyMs: number;
  contentionMode: ContentionMode;
  simulationRunId: string;
  initialPortfolio: PaperPortfolioJson;
  finalPortfolio: PaperPortfolioJson;
  finalInventoryDrift: PaperPortfolioJson;
  executedTrades: number;
  totalNetProfitQuote: number;
  rejectionsByReason: Record<RejectionReason, number>;
  missed: MissedOpportunityReport;
  topExecuted: TopExecutedTrade[];
  topMissed: TopMissedTrade[];
  topRoutesPaperPnL: RouteAggregate[];
  topRoutesMissedPnL: RouteAggregate[];
  topSymbolsEfficiency: SymbolInventoryEfficiency[];
}

export interface ComparisonInput {
  sourceScannerRunId: string;
  policy: PolicyConfig;
  latenciesMs: number[];
  presets: PresetSpec[];
  lifecycles: LifecycleWithEstimates[];
  feeResolver: FeeResolver;
  createdAtMs: number;
  contentionMode: ContentionMode;
  simulationRunIdPrefix: string;
  symbolsFilter?: string[];
  routesFilter?: Array<[string, string]>;
}

export interface ComparisonReport {
  sourceScannerRunId: string;
  policy: PolicyConfig;
  latenciesMs: number[];
  contentionMode: ContentionMode;
  cells: ComparisonCell[];
}

const TOP_LIMIT = 10;

export function runComparison(input: ComparisonInput): ComparisonReport {
  const cells: ComparisonCell[] = [];

  for (const preset of input.presets) {
    const initialPortfolio = buildPresetPortfolio(preset, input.lifecycles);

    for (const latencyMs of input.latenciesMs) {
      const simulationRunId = `${input.simulationRunIdPrefix}_${preset.name}_l${latencyMs}_${input.contentionMode}`;

      // Pass a deep copy so the simulator's ledger mutations cannot leak back
      // into the preset (each latency cell should start from the same state).
      const portfolioForCell: PaperPortfolioJson = cloneShallow(initialPortfolio);

      const result: PaperSimulationResult =
        input.contentionMode === 'multi_route'
          ? new MultiRouteContentionSimulator({
              simulationRunId,
              sourceScannerRunId: input.sourceScannerRunId,
              policy: input.policy,
              latencyMs,
              lifecycles: input.lifecycles,
              initialPortfolio: portfolioForCell,
              feeResolver: input.feeResolver,
              createdAtMs: input.createdAtMs,
              ...(input.symbolsFilter && input.symbolsFilter.length > 0
                ? { symbolsFilter: input.symbolsFilter }
                : {}),
              ...(input.routesFilter && input.routesFilter.length > 0
                ? { routesFilter: input.routesFilter }
                : {}),
            }).run()
          : new PaperSimulator({
              simulationRunId,
              sourceScannerRunId: input.sourceScannerRunId,
              policy: input.policy,
              latencyMs,
              lifecycles: input.lifecycles,
              initialPortfolio: portfolioForCell,
              feeResolver: input.feeResolver,
              createdAtMs: input.createdAtMs,
              ...(input.symbolsFilter && input.symbolsFilter.length > 0
                ? { symbolsFilter: input.symbolsFilter }
                : {}),
              ...(input.routesFilter && input.routesFilter.length > 0
                ? { routesFilter: input.routesFilter }
                : {}),
            }).run();

      const missed = buildMissedOpportunityReport(result.rejections, input.lifecycles, input.policy);

      const cell: ComparisonCell = {
        presetName: preset.name,
        presetLabel: presetLabel(preset),
        latencyMs,
        contentionMode: input.contentionMode,
        simulationRunId,
        initialPortfolio: result.initialPortfolio,
        finalPortfolio: result.finalPortfolio,
        finalInventoryDrift: portfolioDrift(result.initialPortfolio, result.finalPortfolio),
        executedTrades: result.trades.length,
        totalNetProfitQuote: result.totalNetProfitQuote,
        rejectionsByReason: result.rejectionsByReason,
        missed,
        topExecuted: topExecutedTrades(result, TOP_LIMIT),
        topMissed: topMissedTrades(missed, TOP_LIMIT),
        topRoutesPaperPnL: topRoutesByPaperPnL(result.trades, TOP_LIMIT),
        topRoutesMissedPnL: topRoutesByMissedPnL(missed, TOP_LIMIT),
        topSymbolsEfficiency: topSymbolsByInventoryEfficiency(result.trades, TOP_LIMIT),
      };
      cells.push(cell);
    }
  }

  return {
    sourceScannerRunId: input.sourceScannerRunId,
    policy: input.policy,
    latenciesMs: input.latenciesMs,
    contentionMode: input.contentionMode,
    cells,
  };
}

function presetLabel(preset: PresetSpec): string {
  if (preset.name === 'custom') return preset.label;
  return preset.label;
}

function cloneShallow(p: PaperPortfolioJson): PaperPortfolioJson {
  const out: PaperPortfolioJson = {};
  for (const [venue, assets] of Object.entries(p)) {
    out[venue] = { ...assets };
  }
  return out;
}
