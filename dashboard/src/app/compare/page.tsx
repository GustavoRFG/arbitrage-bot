import { Suspense } from 'react';

import {
  listScannerRuns,
  getMostRecentScannerRunId,
  getScannerRun,
  getRunFunnel,
} from '@/lib/queries/observatory';
import {
  getComparisonRun,
  getComparisonScenarios,
  getComparisonMatrix,
  getLatestComparisonRun,
  getMissedPnlByReason,
  getRouteMissedPnlComparison,
  getRoutePnlComparison,
  getSymbolInventoryEfficiency,
  getTopExecutedTrades,
  getTopMissedTrades,
  listComparisonRuns,
} from '@/lib/queries/comparison';
import { computeActionabilityFromMatrix } from '@/lib/actionability';
import {
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtRoute,
  fmtTime,
  fmtUSDT,
  fmtUSDTSigned,
  pnlClass,
} from '@/lib/format';

import { RunSelector } from '@/components/nav/RunSelector';
import { EmptyState } from '@/components/common/EmptyState';
import { MetricCard } from '@/components/kpi/MetricCard';
import { SectionHeader } from '@/components/kpi/SectionHeader';
import { ComparisonMatrixGrid } from '@/components/compare/ComparisonMatrix';
import { ComparisonScenarioPicker } from '@/components/compare/ComparisonScenarioPicker';
import { PnlByPresetLatencyChart } from '@/components/compare/PnlByPresetLatencyChart';
import { MissedPnlByReasonChart } from '@/components/compare/MissedPnlByReasonChart';
import { ComparisonInventoryDriftPanel } from '@/components/compare/ComparisonInventoryDriftPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SearchParams = {
  run?: string;
  comparison?: string;
  preset?: string;
  latency?: string;
};

const EMPTY_CMD = (runId: string | null) =>
  [
    'npx tsx src/cli/paper-cex-compare.ts `',
    `  --run=${runId ?? '<scannerRunId>'} \``,
    "  --symbols='OP/USDT,PYTH/USDT,TIA/USDT,SUI/USDT,AAVE/USDT' `",
    "  --latencies='0,1000,3000,5000,10000' `",
    '  --contention=multi_route',
  ].join('\n');

function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  switch (reason) {
    case 'insufficient_base_inventory':
      return 'insufficient base inventory';
    case 'insufficient_quote_inventory':
      return 'insufficient quote inventory';
    case 'lifecycle_too_short_for_latency':
      return 'lifecycle < latency';
    case 'latency_expired':
      return 'latency expired';
    case 'below_threshold':
      return 'below policy threshold';
    case 'no_eligible_estimate':
      return 'no eligible estimate';
    default:
      return reason;
  }
}

export default async function ComparePage({ searchParams }: { searchParams: SearchParams }) {
  const runs = listScannerRuns(50);
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No scanner runs available"
        description="Run a scanner first, then a paper-comparison to populate this page."
        hint="npm run scan:cex -- --duration=10m"
      />
    );
  }

  const runId = searchParams.run ?? getMostRecentScannerRunId() ?? runs[0]!.runId;
  const run = getScannerRun(runId);
  if (!run) {
    return <EmptyState title={`Scanner run ${runId} not found`} />;
  }

  const allComparisons = listComparisonRuns(runId);
  const comparison =
    (searchParams.comparison ? getComparisonRun(searchParams.comparison) : null) ??
    getLatestComparisonRun(runId);

  if (!comparison) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="heading-eyebrow">Compare Simulator</div>
          <h1 className="heading-h1 mt-1">Paper-comparison cockpit</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Render preset × latency PnL matrices, missed PnL by reason, top
            executed / missed trades and per-scenario inventory drift —
            persisted by <span className="mono">paper:cex:compare</span>.
          </p>
          <Suspense fallback={null}>
            <RunSelector runs={runs} selectedRunId={runId} />
          </Suspense>
        </div>
        <EmptyState
          title="No paper comparison persisted for this scanner run yet"
          description="Generate a comparison run with the CLI command below; then refresh this page."
          hint={EMPTY_CMD(runId)}
        />
      </div>
    );
  }

  const scenarios = getComparisonScenarios(comparison.comparisonRunId);
  const matrix = getComparisonMatrix(comparison.comparisonRunId);
  const selectedPreset =
    searchParams.preset ?? comparison.bestPreset ?? matrix.presets[0]?.name ?? '';
  const selectedLatencyMs =
    searchParams.latency !== undefined
      ? Number(searchParams.latency)
      : comparison.bestLatencyMs ?? matrix.latencies[0] ?? 0;
  const selectedScenario = scenarios.find(
    (s) => s.presetName === selectedPreset && s.latencyMs === selectedLatencyMs,
  );

  const funnel = getRunFunnel(runId);
  const tradableRatio =
    funnel.estimatesCalculated > 0
      ? funnel.estimatesTradablePrefunded / funnel.estimatesCalculated
      : 0;
  const persistenceScore =
    funnel.lifecycles > 0
      ? Math.min(1, funnel.multiObservationLifecycles / Math.max(funnel.lifecycles, 1))
      : 0;
  const actionability = computeActionabilityFromMatrix({
    matrix,
    scenarios,
    tradableRatio,
    persistenceScore,
  });

  const missedByReason = getMissedPnlByReason(comparison.comparisonRunId);
  const topExecuted = selectedScenario
    ? getTopExecutedTrades(comparison.comparisonRunId, selectedScenario.scenarioId)
    : [];
  const topMissed = selectedScenario
    ? getTopMissedTrades(comparison.comparisonRunId, selectedScenario.scenarioId)
    : [];
  const routePnL = selectedScenario
    ? getRoutePnlComparison(comparison.comparisonRunId, selectedScenario.scenarioId)
    : getRoutePnlComparison(comparison.comparisonRunId);
  const routeMissed = selectedScenario
    ? getRouteMissedPnlComparison(comparison.comparisonRunId, selectedScenario.scenarioId)
    : getRouteMissedPnlComparison(comparison.comparisonRunId);
  const symbolEff = selectedScenario
    ? getSymbolInventoryEfficiency(comparison.comparisonRunId, selectedScenario.scenarioId)
    : getSymbolInventoryEfficiency(comparison.comparisonRunId);
  const drift = selectedScenario
    ? {
        initial: JSON.parse(selectedScenario.initialPortfolioJson),
        final: JSON.parse(selectedScenario.finalPortfolioJson),
        drift: JSON.parse(selectedScenario.finalInventoryDriftJson),
      }
    : null;

  const cellPnl = selectedScenario?.totalNetProfitQuote ?? 0;
  const cellMissed = selectedScenario?.totalMissedProfitQuote ?? 0;
  const captureRatio =
    cellPnl + cellMissed > 0 ? cellPnl / (cellPnl + cellMissed) : 0;

  const latenciesParsed: number[] = JSON.parse(comparison.latenciesJson);
  const symbolsFilter: string[] | null = comparison.symbolsFilterJson
    ? JSON.parse(comparison.symbolsFilterJson)
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="heading-eyebrow">Compare Simulator</div>
        <h1 className="heading-h1 mt-1">Paper-comparison cockpit</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Preset × latency PnL, missed PnL by reason, top trades + routes, and
          inventory drift — read straight from the persisted comparison.
        </p>
        <Suspense fallback={null}>
          <RunSelector runs={runs} selectedRunId={runId} />
        </Suspense>
      </div>

      <section className="panel flex flex-wrap items-center gap-4 px-4 py-3 text-xs">
        <div>
          <div className="metric-label">Comparison</div>
          <div className="mono text-sm text-text-primary">{comparison.comparisonRunId}</div>
        </div>
        <div>
          <div className="metric-label">Created</div>
          <div className="text-text-primary">{fmtTime(comparison.createdAtMs)}</div>
        </div>
        <div>
          <div className="metric-label">Label</div>
          <div className="text-text-secondary">{comparison.label ?? '—'}</div>
        </div>
        <div>
          <div className="metric-label">Policy</div>
          <div className="text-text-secondary">
            {comparison.policyName} / {comparison.selectionMode}
          </div>
        </div>
        <div>
          <div className="metric-label">Contention</div>
          <div className="text-text-secondary">{comparison.contentionMode}</div>
        </div>
        <div>
          <div className="metric-label">Latencies</div>
          <div className="mono text-text-secondary">{latenciesParsed.join(' · ')} ms</div>
        </div>
        <div>
          <div className="metric-label">Symbols filter</div>
          <div className="mono text-text-secondary">
            {symbolsFilter && symbolsFilter.length > 0 ? symbolsFilter.join(' · ') : 'all'}
          </div>
        </div>
        <div className="ml-auto">
          <div className="metric-label">Other comparisons</div>
          <div className="text-text-secondary">{allComparisons.length} total</div>
        </div>
      </section>

      <ComparisonScenarioPicker
        presets={matrix.presets}
        latencies={matrix.latencies}
        selectedPreset={selectedPreset}
        selectedLatencyMs={selectedLatencyMs}
      />

      <section>
        <SectionHeader
          eyebrow="Scenario KPIs"
          title="Executed vs missed"
          description={`Selected scenario: ${selectedPreset} · ${selectedLatencyMs}ms`}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Total net PnL"
            value={`${fmtUSDTSigned(cellPnl)} USDT`}
            accent="mint"
          />
          <MetricCard
            label="Total missed PnL"
            value={`${fmtUSDT(cellMissed)} USDT`}
            accent="amber"
          />
          <MetricCard
            label="Capture ratio"
            value={fmtPct(captureRatio * 100, 2)}
            sub={`pnl / (pnl + missed)`}
            accent="cyan"
          />
          <MetricCard
            label="Executed trades"
            value={fmtInt(selectedScenario?.executedTrades ?? 0)}
          />
          <MetricCard
            label="Top bottleneck"
            value={
              <span className="text-sm">
                {reasonLabel(selectedScenario?.topBottleneckReason)}
              </span>
            }
            accent="violet"
          />
          <MetricCard
            label="Actionability"
            value={`${(actionability.total * 100).toFixed(0)} / 100`}
            sub={
              <span className="text-[10px]">
                pnl {(actionability.components.positivePnL * 100).toFixed(0)} · lat{' '}
                {(actionability.components.latencyRobustness * 100).toFixed(0)} · inv{' '}
                {(actionability.components.inventoryReadiness * 100).toFixed(0)}
              </span>
            }
            accent="cyan"
          />
        </div>
        {actionability.notes.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-text-muted">
            {actionability.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <ComparisonMatrixGrid
          matrix={matrix}
          selectedPreset={selectedPreset}
          selectedLatencyMs={selectedLatencyMs}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <PnlByPresetLatencyChart matrix={matrix} />
        <MissedPnlByReasonChart rows={missedByReason} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="metric-label">Top executed trades</div>
            <div className="text-[11px] text-text-muted">
              Selected scenario · sorted by net profit (USDT).
            </div>
          </div>
          {topExecuted.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted">No executed trades.</div>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Symbol
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Route
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Net PnL
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Net spread
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Lifecycle
                  </th>
                </tr>
              </thead>
              <tbody>
                {topExecuted.map((t, idx) => (
                  <tr
                    key={`${t.lifecycleId}-${idx}`}
                    className="border-b border-border-subtle/30 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 mono text-text-primary">{t.symbol}</td>
                    <td className="px-3 py-1.5 text-text-secondary">
                      {fmtRoute(t.buyVenue, t.sellVenue)}
                    </td>
                    <td className={`px-3 py-1.5 text-right mono ${pnlClass(t.netProfitQuote)}`}>
                      {fmtUSDTSigned(t.netProfitQuote)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-text-secondary">
                      {fmtPct(t.netSpreadPct, 4)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-text-muted">{t.lifecycleId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="metric-label">Top missed trades</div>
            <div className="text-[11px] text-text-muted">
              Selected scenario · sorted by missed PnL (USDT) attributable to a rejection.
            </div>
          </div>
          {topMissed.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted">No missed trades recorded.</div>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Symbol
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Route
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Missed PnL
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Reason
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Lifecycle
                  </th>
                </tr>
              </thead>
              <tbody>
                {topMissed.map((m, idx) => (
                  <tr
                    key={`${m.lifecycleId}-${idx}`}
                    className="border-b border-border-subtle/30 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 mono text-text-primary">{m.symbol}</td>
                    <td className="px-3 py-1.5 text-text-secondary">
                      {fmtRoute(m.buyVenue, m.sellVenue)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-accent-amber">
                      {fmtUSDT(m.estimatedMissedProfitQuote)}
                    </td>
                    <td className="px-3 py-1.5 text-text-secondary">{reasonLabel(m.reason)}</td>
                    <td className="px-3 py-1.5 text-right mono text-text-muted">{m.lifecycleId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <RouteAggTable
          title="Top routes by paper PnL"
          rows={routePnL}
          accent="positive"
        />
        <RouteAggTable
          title="Top routes by missed PnL"
          rows={routeMissed}
          accent="amber"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="metric-label">Top symbols by inventory efficiency</div>
            <div className="text-[11px] text-text-muted">
              PnL per base unit traded — high-efficiency symbols may be invisible by raw count.
            </div>
          </div>
          {symbolEff.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted">No symbols traded.</div>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                    Symbol
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Trades
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Total PnL
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    Base qty
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                    PnL / base
                  </th>
                </tr>
              </thead>
              <tbody>
                {symbolEff.map((s) => (
                  <tr key={s.symbol} className="border-b border-border-subtle/30 last:border-b-0">
                    <td className="px-3 py-1.5 mono text-text-primary">{s.symbol}</td>
                    <td className="px-3 py-1.5 text-right mono text-text-secondary">
                      {fmtInt(s.trades)}
                    </td>
                    <td className={`px-3 py-1.5 text-right mono ${pnlClass(s.totalNetProfitQuote)}`}>
                      {fmtUSDTSigned(s.totalNetProfitQuote)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-text-secondary">
                      {fmtUSDT(s.totalBaseQty, 4)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-accent-cyan">
                      {fmtUSDT(s.profitPerBase, 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {drift && (
          <ComparisonInventoryDriftPanel
            initial={drift.initial}
            final={drift.final}
            drift={drift.drift}
          />
        )}
      </section>

      <section className="panel px-4 py-3 text-[11px] text-text-muted">
        Scanner run elapsed:{' '}
        <span className="mono text-text-secondary">
          {fmtDuration(
            run.actualElapsedMs ??
              (run.endedAtMs ? run.endedAtMs - run.startedAtMs : Date.now() - run.startedAtMs),
          )}
        </span>{' '}
        · eligible lifecycles considered:{' '}
        <span className="mono text-text-secondary">{fmtInt(comparison.eligibleLifecycles)}</span>{' '}
        · cells:{' '}
        <span className="mono text-text-secondary">{fmtInt(comparison.cellCount)}</span>
      </section>
    </div>
  );
}

function RouteAggTable({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: Array<{ buyVenue: string; sellVenue: string; trades: number; totalQuote: number }>;
  accent: 'positive' | 'amber';
}) {
  const totalClass = accent === 'positive' ? 'text-signal-positive' : 'text-accent-amber';
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="metric-label">{title}</div>
        <div className="text-[11px] text-text-muted">Aggregated within selected scenario.</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-text-muted">No data.</div>
      ) : (
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                Route
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                Trades
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                Total quote
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.buyVenue}-${r.sellVenue}`}
                className="border-b border-border-subtle/30 last:border-b-0"
              >
                <td className="px-3 py-1.5 text-text-secondary">{fmtRoute(r.buyVenue, r.sellVenue)}</td>
                <td className="px-3 py-1.5 text-right mono text-text-secondary">{fmtInt(r.trades)}</td>
                <td className={`px-3 py-1.5 text-right mono ${totalClass}`}>
                  {fmtUSDT(r.totalQuote)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
