'use client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtUSDT } from '@/lib/format';
import type { RejectionReason } from '@/lib/queries/simulator';

interface Row {
  presetName: string;
  latencyMs: number;
  byReason: Record<RejectionReason, number>;
}

const REASON_COLORS: Record<RejectionReason, string> = {
  insufficient_base_inventory: '#f59e0b',
  insufficient_quote_inventory: '#fbbf24',
  lifecycle_too_short_for_latency: '#a78bfa',
  latency_expired: '#8b5cf6',
  below_threshold: '#64748b',
  no_eligible_estimate: '#475569',
};

const REASON_LABEL: Record<RejectionReason, string> = {
  insufficient_base_inventory: 'base inventory',
  insufficient_quote_inventory: 'quote inventory',
  lifecycle_too_short_for_latency: 'lifecycle < latency',
  latency_expired: 'latency expired',
  below_threshold: 'below threshold',
  no_eligible_estimate: 'no estimate',
};

const REASON_ORDER: RejectionReason[] = [
  'insufficient_base_inventory',
  'insufficient_quote_inventory',
  'lifecycle_too_short_for_latency',
  'latency_expired',
  'below_threshold',
  'no_eligible_estimate',
];

export function MissedPnlByReasonChart({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel grid h-[300px] place-items-center text-sm text-text-secondary">
        No missed-PnL data available.
      </div>
    );
  }

  const data = rows.map((r) => {
    const row: Record<string, number | string> = {
      label: `${r.presetName.slice(0, 4)} · ${r.latencyMs}ms`,
    };
    for (const reason of REASON_ORDER) {
      row[reason] = Number((r.byReason[reason] ?? 0).toFixed(4));
    }
    return row;
  });

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">Missed PnL by reason</div>
          <div className="text-[11px] text-text-muted">
            Missed value (USDT) attributable to each rejection cause, per scenario.
          </div>
        </div>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
              tick={{ fontSize: 10 }}
              interval={0}
            />
            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
              width={56}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              cursor={{ fill: 'rgba(95,210,255,0.05)' }}
              contentStyle={{
                background: 'rgba(13,17,23,0.95)',
                border: '1px solid #1f2937',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name) => [
                `${fmtUSDT(value)} USDT`,
                REASON_LABEL[name as RejectionReason] ?? String(name),
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value) => REASON_LABEL[value as RejectionReason] ?? String(value)}
            />
            {REASON_ORDER.map((reason) => (
              <Bar
                key={reason}
                dataKey={reason}
                stackId="missed"
                fill={REASON_COLORS[reason]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
