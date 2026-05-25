import Link from 'next/link';
import type { SimulationFamily, RejectionReason } from '@/lib/queries/simulator';
import { fmtInt, fmtMs, fmtUSDTSigned, pnlClass } from '@/lib/format';
import { EmptyState } from '../common/EmptyState';
import { parseRejections } from '@/lib/queries/simulator';

export function PaperSummaryPanel({
  scannerRunId,
  families,
}: {
  scannerRunId: string;
  families: SimulationFamily[];
}) {
  if (families.length === 0) {
    return (
      <EmptyState
        title="No paper simulations yet"
        description={`Generate one against this scanner run to compare prefunded execution scenarios.`}
        hint={`npm run paper:cex -- --run=${scannerRunId}`}
      />
    );
  }

  // Use the most recent family.
  const family = families[0]!;
  const best = family.scenarios.reduce<typeof family.scenarios[number]>(
    (acc, s) => (s.totalNetProfitQuote > acc.totalNetProfitQuote ? s : acc),
    family.scenarios[0]!,
  );
  const aggregateRejections = aggregateFamilyRejections(family);
  const dominantRejection = pickDominantRejection(aggregateRejections);

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="heading-eyebrow mb-1">Paper simulator · most recent</div>
          <h3 className="heading-h2">
            {family.policyName}
            <span className="ml-3 pill mono">{family.selectionMode}</span>
          </h3>
          <p className="mt-1 text-xs text-text-secondary">
            Best of {family.scenarios.length} latency scenario
            {family.scenarios.length === 1 ? '' : 's'} ·{' '}
            <span className="mono">min profit {family.minProfitQuote.toFixed(2)} USDT</span>
            <span className="text-text-muted"> · </span>
            <span className="mono">spread ≥ {family.minSpreadPct}%</span>
            <span className="text-text-muted"> · </span>
            <span className="mono">notional ≤ {family.maxNotionalQuote.toFixed(0)}</span>
          </p>
        </div>
        <Link
          href={`/simulator?run=${scannerRunId}&sim=${encodeURIComponent(family.familyId)}`}
          className="text-xs text-accent-cyan transition-colors hover:text-text-primary"
        >
          open simulator →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Best PnL" value={fmtUSDTSigned(best.totalNetProfitQuote)} accent="mint" />
        <Stat label="Best latency" value={fmtMs(best.latencyMs)} />
        <Stat label="Trades executed" value={fmtInt(best.totalTrades)} />
        <Stat label="Eligible lifecycles" value={fmtInt(best.eligibleLifecycles)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Rejected (total)"
          value={fmtInt(best.totalRejected)}
          accent="coral"
        />
        <Stat
          label="Dominant rejection"
          value={dominantRejection ? dominantRejection.label : '—'}
          subValue={dominantRejection ? fmtInt(dominantRejection.count) : ''}
        />
        <Stat
          label="Avg PnL / trade"
          value={fmtUSDTSigned(
            best.totalTrades > 0 ? best.totalNetProfitQuote / best.totalTrades : 0,
          )}
          accent={best.totalTrades > 0 ? 'mint' : undefined}
        />
        <Stat
          label="Latency robustness"
          value={describeLatencyRobustness(family.scenarios)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2 text-[12px]">
        {family.scenarios
          .slice()
          .sort((a, b) => a.latencyMs - b.latencyMs)
          .map((s) => (
            <span key={s.simulationRunId} className="flex items-baseline gap-1.5">
              <span className="mono text-text-muted">{fmtMs(s.latencyMs)}</span>
              <span className={`mono ${pnlClass(s.totalNetProfitQuote)}`}>
                {fmtUSDTSigned(s.totalNetProfitQuote)}
              </span>
              <span className="text-text-muted">·</span>
              <span className="mono text-text-secondary">{fmtInt(s.totalTrades)} trades</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function aggregateFamilyRejections(family: SimulationFamily): Record<RejectionReason, number> {
  const totals: Record<RejectionReason, number> = {
    no_eligible_estimate: 0,
    below_threshold: 0,
    latency_expired: 0,
    insufficient_quote_inventory: 0,
    insufficient_base_inventory: 0,
    lifecycle_too_short_for_latency: 0,
  };
  for (const scenario of family.scenarios) {
    const r = parseRejections(scenario.rejectionsJson);
    for (const key of Object.keys(totals) as RejectionReason[]) {
      totals[key] += r[key] ?? 0;
    }
  }
  return totals;
}

function pickDominantRejection(
  rejections: Record<RejectionReason, number>,
): { reason: RejectionReason; count: number; label: string } | null {
  let best: { reason: RejectionReason; count: number } | null = null;
  for (const [reason, count] of Object.entries(rejections) as Array<[RejectionReason, number]>) {
    if (count > 0 && (!best || count > best.count)) {
      best = { reason, count };
    }
  }
  if (!best) return null;
  return { ...best, label: REJECTION_LABEL[best.reason] };
}

const REJECTION_LABEL: Record<RejectionReason, string> = {
  no_eligible_estimate: 'No eligible estimate',
  below_threshold: 'Below threshold',
  latency_expired: 'Latency expired',
  insufficient_quote_inventory: 'Insufficient quote',
  insufficient_base_inventory: 'Insufficient base',
  lifecycle_too_short_for_latency: 'Lifecycle too short',
};

function describeLatencyRobustness(
  scenarios: SimulationFamily['scenarios'],
): string {
  if (scenarios.length < 2) return '—';
  const sorted = scenarios.slice().sort((a, b) => a.latencyMs - b.latencyMs);
  const first = sorted[0]!.totalNetProfitQuote;
  const last = sorted[sorted.length - 1]!.totalNetProfitQuote;
  if (Math.abs(first) < 1e-6) return last > 0 ? '+∞' : '—';
  const delta = ((last - first) / Math.abs(first)) * 100;
  if (Math.abs(delta) < 1) return 'flat across L';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(0)}% over Lmax`;
}

function Stat({
  label,
  value,
  subValue,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  accent?: 'mint' | 'coral';
}) {
  const color =
    accent === 'mint'
      ? 'text-signal-positive'
      : accent === 'coral'
        ? 'text-signal-negative'
        : 'text-text-primary';
  return (
    <div className="panel-tight p-3">
      <div className="metric-label mb-1">{label}</div>
      <div className={`mono tabular text-lg font-semibold ${color}`}>{value}</div>
      {subValue !== undefined && <div className="mt-0.5 mono text-[11px] text-text-muted">{subValue}</div>}
    </div>
  );
}
