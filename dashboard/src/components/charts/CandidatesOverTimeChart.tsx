'use client';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeBucket } from '@/lib/queries/observatory';

export function CandidatesOverTimeChart({ buckets }: { buckets: TimeBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="panel grid h-[220px] place-items-center text-sm text-text-secondary">
        No candidate timeline yet.
      </div>
    );
  }

  const data = buckets.map((b) => ({
    t: b.bucketStartMs,
    label: new Date(b.bucketStartMs).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    candidates: b.candidates,
  }));

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">Candidate flow over time</div>
          <div className="text-[11px] text-text-muted">
            Raw cross-exchange candidates per time bucket across the run.
          </div>
        </div>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="cand-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5fd2ff" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#5fd2ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
              minTickGap={32}
            />
            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#37445e', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="candidates"
              stroke="#5fd2ff"
              strokeWidth={1.5}
              fill="url(#cand-area)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="metric-label mb-1">{label}</div>
      <div className="mono text-sm text-accent-cyan">
        {payload[0]?.value ?? 0} candidates
      </div>
    </div>
  );
}
