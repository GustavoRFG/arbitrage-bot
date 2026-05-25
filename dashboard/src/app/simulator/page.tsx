import {
  listScannerRuns,
  getMostRecentScannerRunId,
  getScannerRun,
} from '@/lib/queries/observatory';
import {
  listSimulationFamilies,
  listPaperTrades,
  aggregateRoutePnL,
  aggregateSymbolPnL,
  parseRejections,
  parsePortfolio,
  portfolioDrift,
} from '@/lib/queries/simulator';
import { fmtInt, fmtMs, fmtTime, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';

import { RunSelector } from '@/components/nav/RunSelector';
import { MetricCard } from '@/components/kpi/MetricCard';
import { StatusBadge } from '@/components/kpi/StatusBadge';
import { SectionHeader } from '@/components/kpi/SectionHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SimulationFamilySelector } from '@/components/simulator/SimulationFamilySelector';
import { LatencyScenarioPicker } from '@/components/simulator/LatencyScenarioPicker';
import { PnLByLatencyChart } from '@/components/simulator/PnLByLatencyChart';
import { RejectionReasonsChart } from '@/components/simulator/RejectionReasonsChart';
import { InventoryDriftPanel } from '@/components/simulator/InventoryDriftPanel';
import {
  RoutePnLTable,
  SymbolPnLTable,
} from '@/components/simulator/RouteSymbolPnLTables';
import { TradeLogTable } from '@/components/simulator/TradeLogTable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SearchParams = { run?: string; sim?: string; latency?: string };

export default async function SimulatorPage({ searchParams }: { searchParams: SearchParams }) {
  const runs = listScannerRuns(50);
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No scanner runs found"
        description="Start a scan first; the paper simulator runs against existing Observatory data."
        hint="npm run scan:cex -- --duration=10m"
      />
    );
  }
  const runId = searchParams.run ?? getMostRecentScannerRunId() ?? runs[0]!.runId;
  const run = getScannerRun(runId);
  const families = listSimulationFamilies(runId);

  if (families.length === 0) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="heading-eyebrow">Paper Simulator</div>
              <h1 className="heading-h1 mt-1">No paper simulations for this run yet</h1>
              <p className="mt-1 text-sm text-text-secondary">
                Generate one to compare prefunded execution scenarios at multiple latencies.
              </p>
            </div>
            {run && <StatusBadge status={run.status} />}
          </div>
          <RunSelector runs={runs} selectedRunId={runId} />
        </header>
        <EmptyState
          title="No paper simulations found"
          description={`No simulator runs have been recorded for scanner run ${runId}.`}
          hint={`npm run paper:cex -- --run=${runId}`}
        />
      </div>
    );
  }

  const selectedFamily =
    families.find((f) => f.familyId === searchParams.sim) ?? families[0]!;

  const selectedLatencyMs = (() => {
    if (searchParams.latency !== undefined) {
      const parsed = Number(searchParams.latency);
      const match = selectedFamily.scenarios.find((s) => s.latencyMs === parsed);
      if (match) return match.latencyMs;
    }
    // Default: latency with the best PnL — most useful single scenario to drill into.
    const best = selectedFamily.scenarios.reduce<typeof selectedFamily.scenarios[number]>(
      (acc, s) => (s.totalNetProfitQuote > acc.totalNetProfitQuote ? s : acc),
      selectedFamily.scenarios[0]!,
    );
    return best.latencyMs;
  })();

  const scenario = selectedFamily.scenarios.find((s) => s.latencyMs === selectedLatencyMs)!;
  const trades = listPaperTrades(scenario.simulationRunId, 500);
  const routePnL = aggregateRoutePnL(trades);
  const symbolPnL = aggregateSymbolPnL(trades);
  const rejections = parseRejections(scenario.rejectionsJson);
  const initialPortfolio = parsePortfolio(scenario.initialPortfolioJson);
  const finalPortfolio = parsePortfolio(scenario.finalPortfolioJson);
  const drift = portfolioDrift(initialPortfolio, finalPortfolio);

  const bestTrade = trades.reduce<(typeof trades)[number] | null>(
    (acc, t) => (acc === null || t.netProfitQuote > acc.netProfitQuote ? t : acc),
    null,
  );
  const median = computeMedian(trades.map((t) => t.netProfitQuote));
  const avg =
    trades.length > 0
      ? trades.reduce((acc, t) => acc + t.netProfitQuote, 0) / trades.length
      : 0;

  const latencyPoints = selectedFamily.scenarios.map((s) => ({
    latencyMs: s.latencyMs,
    totalNetProfitQuote: s.totalNetProfitQuote,
    totalTrades: s.totalTrades,
    totalRejected: s.totalRejected,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="heading-eyebrow">Paper Simulator</div>
            <h1 className="heading-h1 mt-1">
              <span className="mono">{selectedFamily.policyName}</span>
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              source run <span className="mono text-text-secondary">{runId}</span>
              <span className="mx-2 text-text-faint">·</span>
              created {fmtTime(selectedFamily.createdAtMs)}
              <span className="mx-2 text-text-faint">·</span>
              selection <span className="mono text-text-secondary">{selectedFamily.selectionMode}</span>
            </p>
          </div>
          {run && <StatusBadge status={run.status} />}
        </div>
        <RunSelector runs={runs} selectedRunId={runId} />
        <SimulationFamilySelector
          families={families}
          selectedFamilyId={selectedFamily.familyId}
        />
      </header>

      <LatencyScenarioPicker
        scenarios={selectedFamily.scenarios}
        selectedLatencyMs={selectedLatencyMs}
      />

      <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Executed trades"
          value={fmtInt(scenario.totalTrades)}
          accent="cyan"
        />
        <MetricCard
          label="Total net PnL"
          value={`${fmtUSDTSigned(scenario.totalNetProfitQuote)} USDT`}
          accent="mint"
        />
        <MetricCard
          label="Avg PnL / trade"
          value={`${fmtUSDTSigned(avg)} USDT`}
        />
        <MetricCard
          label="Median PnL / trade"
          value={`${fmtUSDTSigned(median)} USDT`}
        />
        <MetricCard
          label="Best trade"
          value={
            bestTrade ? (
              <span className="mono text-base">{fmtUSDTSigned(bestTrade.netProfitQuote)}</span>
            ) : (
              '—'
            )
          }
          sub={
            bestTrade
              ? `${bestTrade.symbol} · ${bestTrade.buyVenue} → ${bestTrade.sellVenue}`
              : ''
          }
          accent="mint"
        />
        <MetricCard
          label="Eligible lifecycles"
          value={fmtInt(scenario.eligibleLifecycles)}
          sub={`${fmtInt(scenario.totalRejected)} rejected`}
          accent="amber"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PnLByLatencyChart points={latencyPoints} />
        </div>
        <RejectionReasonsChart rejections={rejections} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader eyebrow="Routes" title="Paper PnL by route" />
          <RoutePnLTable rows={routePnL} />
        </div>
        <div>
          <SectionHeader eyebrow="Symbols" title="Paper PnL by symbol" />
          <SymbolPnLTable rows={symbolPnL} />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Capital"
          title={`Inventory drift @ latency ${fmtMs(scenario.latencyMs)}`}
          description="Per-venue balance change between the start and end of the simulation."
        />
        <InventoryDriftPanel
          initial={initialPortfolio}
          final={finalPortfolio}
          drift={drift}
        />
      </section>

      <section>
        <SectionHeader
          eyebrow="Trade log"
          title="Simulated paper trades"
          description={`Up to 500 trades for this scenario, in execution order.`}
          right={
            <span className="text-[11px] text-text-muted">
              policy <span className="mono">{selectedFamily.policyName}</span>
              <span className="mx-1.5 text-text-faint">·</span>
              max notional{' '}
              <span className="mono">{fmtUSDT(selectedFamily.maxNotionalQuote, 0)}</span>
            </span>
          }
        />
        <TradeLogTable trades={trades} />
      </section>
    </div>
  );
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
