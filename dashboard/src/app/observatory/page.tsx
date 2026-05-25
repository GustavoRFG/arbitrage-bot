import {
  listScannerRuns,
  getMostRecentScannerRunId,
  getScannerRun,
  getRunFunnel,
  getRunHeadlineStats,
  getSymbolBreakdown,
  getRouteBreakdown,
  getTopLifecycles,
  getCandidatesOverTime,
} from '@/lib/queries/observatory';
import { fmtDuration, fmtInt, fmtTime, fmtUSDT } from '@/lib/format';

import { RunSelector } from '@/components/nav/RunSelector';
import { StatusBadge } from '@/components/kpi/StatusBadge';
import { MetricCard } from '@/components/kpi/MetricCard';
import { SectionHeader } from '@/components/kpi/SectionHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { UniverseMetadataCard } from '@/components/observatory/UniverseMetadataCard';
import { MaterialRuleCard } from '@/components/observatory/MaterialRuleCard';
import { FunnelMetrics } from '@/components/observatory/FunnelMetrics';
import { SymbolLeaderboard } from '@/components/observatory/SymbolLeaderboard';
import { RouteLeaderboard } from '@/components/observatory/RouteLeaderboard';
import { LifecycleTable } from '@/components/observatory/LifecycleTable';
import { CandidatesOverTimeChart } from '@/components/charts/CandidatesOverTimeChart';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SearchParams = { run?: string };

export default async function ObservatoryPage({ searchParams }: { searchParams: SearchParams }) {
  const runs = listScannerRuns(50);
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No scanner runs found"
        description="Start a scan so the Observatory can build a research dataset."
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
        description="Select a different run from the picker below."
      />
    );
  }

  const funnel = getRunFunnel(runId);
  const headline = getRunHeadlineStats(runId);
  const symbols = getSymbolBreakdown(runId);
  const routes = getRouteBreakdown(runId);
  const lifecycles = getTopLifecycles(runId, 12);
  const timeline = getCandidatesOverTime(runId, 80);

  const effectiveElapsedMs =
    run.actualElapsedMs ??
    (run.endedAtMs ? run.endedAtMs - run.startedAtMs : Date.now() - run.startedAtMs);
  const candPerHour =
    effectiveElapsedMs > 0 ? (run.totalCandidates / effectiveElapsedMs) * 3_600_000 : 0;
  const lcPerHour =
    effectiveElapsedMs > 0 ? (funnel.lifecycles / effectiveElapsedMs) * 3_600_000 : 0;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="heading-eyebrow">Observatory</div>
            <h1 className="heading-h1 mt-1">
              <span className="mono text-text-primary">{run.runId}</span>
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              {fmtTime(run.startedAtMs)}
              <span className="mx-2">→</span>
              {run.endedAtMs ? fmtTime(run.endedAtMs) : 'still running'}
              <span className="mx-2 text-text-faint">·</span>
              <span className="mono text-text-secondary">{fmtDuration(effectiveElapsedMs)}</span>
            </p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <RunSelector runs={runs} selectedRunId={runId} />
      </header>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cycles" value={fmtInt(run.totalCycles)} />
        <MetricCard
          label="Symbols scanned"
          value={fmtInt(run.totalSymbolsScanned)}
        />
        <MetricCard
          label="Candidates / hour"
          value={fmtInt(candPerHour)}
          accent="cyan"
          sub={`${fmtInt(run.totalCandidates)} total`}
        />
        <MetricCard
          label="Lifecycles / hour"
          value={fmtInt(lcPerHour)}
          accent="violet"
          sub={`${fmtInt(funnel.lifecycles)} total`}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <UniverseMetadataCard universe={run.universe} />
        <MaterialRuleCard
          universe={run.universe}
          totalMaterialCandidates={run.totalMaterialCandidates}
          totalCandidates={run.totalCandidates}
        />
        <FunnelMetrics funnel={funnel} />
      </section>

      <section>
        <SectionHeader
          eyebrow="Flow"
          title="Candidate timeline"
          description="Per-bucket candidate counts across the scanner run."
        />
        <CandidatesOverTimeChart buckets={timeline} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Max simulated profit"
          value={`${fmtUSDT(headline.maxNetProfitQuote)} USDT`}
          accent="mint"
        />
        <MetricCard
          label="Median est. profit"
          value={`${fmtUSDT(headline.medianNetProfitQuote)} USDT`}
        />
        <MetricCard label="Longest lifecycle" value={fmtDuration(headline.longestLifecycleMs)} />
        <MetricCard label="Median lifecycle" value={fmtDuration(headline.medianLifecycleMs)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader eyebrow="By symbol" title="Where the candidates are landing" />
          <SymbolLeaderboard rows={symbols} />
        </div>
        <div>
          <SectionHeader eyebrow="By route" title="Which venue pairs are dislocating" />
          <RouteLeaderboard rows={routes} />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Persistence"
          title="Top lifecycles by duration"
          description="Long-lived episodes are the most actionable for prefunded execution."
        />
        <LifecycleTable rows={lifecycles} />
      </section>
    </div>
  );
}
