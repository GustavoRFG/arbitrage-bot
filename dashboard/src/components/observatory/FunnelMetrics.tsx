import type { RunFunnel } from '@/lib/queries/observatory';
import { fmtInt } from '@/lib/format';

export function FunnelMetrics({ funnel }: { funnel: RunFunnel }) {
  const total = Math.max(funnel.rawCandidates, 1);
  const stages = [
    {
      label: 'Raw candidates',
      value: funnel.rawCandidates,
      pct: 1,
      accent: 'text-text-primary',
      bar: 'from-accent-cyan/70 to-accent-cyan/10',
    },
    {
      label: 'Net-positive after fees',
      value: funnel.candidatesNetPositive,
      pct: funnel.candidatesNetPositive / total,
      accent: 'text-accent-cyan',
      bar: 'from-accent-cyan/60 to-accent-cyan/10',
    },
    {
      label: 'Depth estimates',
      value: funnel.estimatesCalculated,
      pct: Math.min(1, funnel.estimatesCalculated / Math.max(total, 1)),
      accent: 'text-text-primary',
      bar: 'from-accent-teal/60 to-accent-teal/10',
    },
    {
      label: 'Tradable (prefunded)',
      value: funnel.estimatesTradablePrefunded,
      pct: Math.min(1, funnel.estimatesTradablePrefunded / Math.max(funnel.estimatesCalculated, 1)),
      accent: 'text-signal-positive',
      bar: 'from-signal-positive/60 to-signal-positive/10',
    },
    {
      label: 'Lifecycles',
      value: funnel.lifecycles,
      pct: Math.min(1, funnel.lifecycles / Math.max(total, 1)),
      accent: 'text-accent-violet',
      bar: 'from-accent-violet/60 to-accent-violet/10',
    },
    {
      label: 'Multi-observation',
      value: funnel.multiObservationLifecycles,
      pct: Math.min(1, funnel.multiObservationLifecycles / Math.max(funnel.lifecycles, 1)),
      accent: 'text-accent-amber',
      bar: 'from-accent-amber/60 to-accent-amber/10',
    },
  ];

  return (
    <div className="panel p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="metric-label">Candidate funnel</div>
          <div className="text-[11px] text-text-muted">
            How point-in-time observations narrow into actionable opportunities.
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-text-secondary">{s.label}</span>
              <span className={`num tabular ${s.accent}`}>{fmtInt(s.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${s.bar}`}
                style={{ width: `${Math.max(2, s.pct * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
