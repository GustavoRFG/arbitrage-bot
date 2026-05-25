'use client';
import { fmtInt } from '@/lib/format';
import type { RejectionReason } from '@/lib/queries/simulator';

const REASON_LABELS: Record<RejectionReason, { label: string; color: string }> = {
  below_threshold: { label: 'Below threshold', color: '#a78bfa' },
  lifecycle_too_short_for_latency: { label: 'Lifecycle too short', color: '#f5c87a' },
  insufficient_quote_inventory: { label: 'Insufficient quote', color: '#f47272' },
  insufficient_base_inventory: { label: 'Insufficient base', color: '#fb7185' },
  latency_expired: { label: 'Latency expired', color: '#fcd34d' },
  no_eligible_estimate: { label: 'No eligible estimate', color: '#94a3b8' },
};

export function RejectionReasonsChart({
  rejections,
}: {
  rejections: Record<RejectionReason, number>;
}) {
  const total = Object.values(rejections).reduce((acc, v) => acc + v, 0);
  const entries = (Object.entries(rejections) as Array<[RejectionReason, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return (
      <div className="panel p-4">
        <div className="metric-label mb-2">Rejections by reason</div>
        <p className="text-sm text-text-secondary">
          No rejections recorded — every eligible lifecycle was executed.
        </p>
      </div>
    );
  }

  const max = entries[0]?.[1] ?? 1;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">Rejections by reason</div>
          <div className="text-[11px] text-text-muted">
            {fmtInt(total)} rejection{total === 1 ? '' : 's'} across the simulation.
          </div>
        </div>
      </div>
      <ul className="space-y-2.5">
        {entries.map(([reason, count]) => {
          const meta = REASON_LABELS[reason];
          const pct = max > 0 ? (count / max) * 100 : 0;
          return (
            <li key={reason}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-text-secondary">{meta.label}</span>
                <span className="num text-text-primary">{fmtInt(count)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(3, pct).toFixed(1)}%`,
                    background: `linear-gradient(90deg, ${meta.color}cc 0%, ${meta.color}33 100%)`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
