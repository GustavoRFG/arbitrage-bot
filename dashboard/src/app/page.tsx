import { Suspense } from 'react';
import {
  listScannerRuns,
  getMostRecentScannerRunId,
  getScannerRun,
  getRunFunnel,
  getRunHeadlineStats,
  getSymbolBreakdown,
  getRouteBreakdown,
  getCandidatesOverTime,
} from '@/lib/queries/observatory';
import { listSimulationFamilies } from '@/lib/queries/simulator';
import { getLatestComparisonRun } from '@/lib/queries/comparison';
import { detectDominantRegime } from '@/lib/regime';
import { RegimeComparisonCards } from '@/components/overview/RegimeComparisonCards';
import { fmtDuration, fmtInt, fmtPct, fmtTime, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';

import { RunSelector } from '@/components/nav/RunSelector';
import { MetricCard } from '@/components/kpi/MetricCard';
import { StatusBadge } from '@/components/kpi/StatusBadge';
import { SectionHeader } from '@/components/kpi/SectionHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { RegimeCallout } from '@/components/overview/RegimeCallout';
import { PaperSummaryPanel } from '@/components/overview/PaperSummaryPanel';
import { CandidatesOverTimeChart } from '@/components/charts/CandidatesOverTimeChart';
import { SymbolLeaderboard } from '@/components/observatory/SymbolLeaderboard';
import { RouteLeaderboard } from '@/components/observatory/RouteLeaderboard';

// Force per-request dynamic rendering — every page hit reads SQLite live.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SearchParams = { run?: string };

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const runs = listScannerRuns(50);
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No scanner runs found"
        description="The dashboard reads the SQLite database written by the scanner. Start a scan to populate live observability data."
        hint="npm run scan:cex -- --duration=10m"
      />
    );
  }

  const runId = searchParams.run ?? getMostRecentScannerRunId() ?? runs[0]!.runId;
  const run = getScannerRun(runId);
  if (!run) {
    return (
      <EmptyState
        title={`Scanner run ${runId} not found`}
        description="Pick a different run from the selector below."
      />
    );
  }

  const funnel = getRunFunnel(runId);
  const headline = getRunHeadlineStats(runId);
  const symbols = getSymbolBreakdown(runId);
  const routes = getRouteBreakdown(runId);
  const timeline = getCandidatesOverTime(runId, 60);
  const families = listSimulationFamilies(runId);
  const regime = detectDominantRegime(symbols, routes);
  const latestComparison = getLatestComparisonRun(runId);

  // Top actionable symbol = symbol with at least one tradable+prefunded estimate
  // and a positive max executable net profit.
  const actionableSymbol = symbols
    .filter((s) => s.tradableEstimates > 0 && s.maxNetProfitQuote > 0)
    .sort((a, b) => b.maxNetProfitQuote - a.maxNetProfitQuote)[0];

  const effectiveElapsedMs =
    run.actualElapsedMs ??
    (run.endedAtMs ? run.endedAtMs - run.startedAtMs : Date.now() - run.startedAtMs);
  const candPerHour =
    effectiveElapsedMs > 0 ? (run.totalCandidates / effectiveElapsedMs) * 3_600_000 : 0;
  const lcPerHour =
    effectiveElapsedMs > 0 ? (funnel.lifecycles / effectiveElapsedMs) * 3_600_000 : 0;
  const tradableRatio =
    funnel.estimatesCalculated > 0
      ? funnel.estimatesTradablePrefunded / funnel.estimatesCalculated
      : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-end justify-between">
          <div>
            <div className="heading-eyebrow">Overview</div>
            <h1 className="heading-h1 mt-1">Quant arbitrage observatory</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Cross-exchange spot-arbitrage detection and prefunded paper-execution simulations — at
              a glance.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="text-[11px] text-text-muted">
              started {fmtTime(run.startedAtMs)} ·{' '}
              <span className="mono">{fmtDuration(effectiveElapsedMs)}</span>
            </span>
          </div>
        </div>
        <Suspense fallback={null}>
          <RunSelector runs={runs} selectedRunId={runId} />
        </Suspense>
      </div>

      <RegimeCallout regime={regime} />

      <RegimeComparisonCards
        scannerRunId={runId}
        rawRegime={{
          topSymbol: regime?.topSymbol ?? symbols[0]?.symbol ?? null,
          sellSink: regime?.sellSink ?? null,
          sourceVenues: regime?.sourceVenues ?? [],
          description: regime?.description ?? null,
        }}
        actionable={{
          topSymbol: actionableSymbol?.symbol ?? null,
          tradableRatio,
          medianPositiveEstimate: headline.medianNetProfitQuote,
          maxPositiveEstimate: headline.maxNetProfitQuote,
          prefundedTradableCount: funnel.estimatesTradablePrefunded,
          estimatesCalculated: funnel.estimatesCalculated,
        }}
        comparison={latestComparison}
      />

      <section>
        <SectionHeader
          eyebrow="Run vitals"
          title="Scanner activity"
          description="Throughput and headline counts for the selected scanner run."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Cycles" value={fmtInt(run.totalCycles)} />
          <MetricCard
            label="Symbols scanned"
            value={fmtInt(run.totalSymbolsScanned)}
            sub={`${run.universe?.enabledExchanges.length ?? 0} exchanges`}
          />
          <MetricCard
            label="Raw candidates"
            value={fmtInt(run.totalCandidates)}
            sub={`${candPerHour.toFixed(0)} / hr`}
            accent="cyan"
          />
          <MetricCard
            label="Material candidates"
            value={fmtInt(run.totalMaterialCandidates)}
            sub={`${((run.totalMaterialCandidates / Math.max(run.totalCandidates, 1)) * 100).toFixed(1)}% pass`}
            accent="mint"
          />
          <MetricCard
            label="Lifecycles"
            value={fmtInt(funnel.lifecycles)}
            sub={`${fmtInt(funnel.multiObservationLifecycles)} multi-obs`}
            accent="violet"
          />
          <MetricCard
            label="Tradable ratio"
            value={fmtPct(tradableRatio * 100)}
            sub={`${fmtInt(funnel.estimatesTradablePrefunded)} / ${fmtInt(funnel.estimatesCalculated)}`}
            accent="cyan"
          />
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Best of run" title="Edge surfaced by the Observatory" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Max simulated profit"
            value={`${fmtUSDT(headline.maxNetProfitQuote)} USDT`}
            accent="mint"
          />
          <MetricCard
            label="Median est. profit"
            value={`${fmtUSDT(headline.medianNetProfitQuote)} USDT`}
          />
          <MetricCard
            label="Longest lifecycle"
            value={fmtDuration(headline.longestLifecycleMs)}
            accent="amber"
          />
          <MetricCard
            label="Median lifecycle"
            value={fmtDuration(headline.medianLifecycleMs)}
          />
          <MetricCard
            label="Top symbol"
            value={
              headline.bestSymbol ? (
                <span className="mono">{headline.bestSymbol.symbol}</span>
              ) : (
                '—'
              )
            }
            sub={headline.bestSymbol ? `${headline.bestSymbol.count} candidates` : ''}
            accent="cyan"
          />
          <MetricCard
            label="Top route"
            value={
              headline.bestRoute ? (
                <span className="mono text-base">
                  {headline.bestRoute.buyExchange} → {headline.bestRoute.sellExchange}
                </span>
              ) : (
                '—'
              )
            }
            sub={headline.bestRoute ? `${headline.bestRoute.count} candidates` : ''}
            accent="cyan"
          />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CandidatesOverTimeChart buckets={timeline} />
        </div>
        <PaperSummaryPanel scannerRunId={runId} families={families} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader eyebrow="Symbols" title="Top symbol regimes" />
          <SymbolLeaderboard rows={symbols} limit={8} />
        </div>
        <div>
          <SectionHeader eyebrow="Routes" title="Top venue routes" />
          <RouteLeaderboard rows={routes} limit={8} />
        </div>
      </section>
    </div>
  );
}
