'use client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtInt, fmtUSDTSigned } from '@/lib/format';

export interface LatencyPoint {
  latencyMs: number;
  totalNetProfitQuote: number;
  totalTrades: number;
  totalRejected: number;
}

export function PnLByLatencyChart({ points }: { points: LatencyPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="panel grid h-[280px] place-items-center text-sm text-text-secondary">
        No latency scenarios available for this simulation family.
      </div>
    );
  }
  const data = points
    .slice()
    .sort((a, b) => a.latencyMs - b.latencyMs)
    .map((p) => ({
      latency: p.latencyMs,
      label: `${p.latencyMs}ms`,
      pnl: Number(p.totalNetProfitQuote.toFixed(4)),
      trades: p.totalTrades,
      rejected: p.totalRejected,
    }));

  const maxPnL = Math.max(0, ...data.map((d) => d.pnl));
  const minPnL = Math.min(0, ...data.map((d) => d.pnl));

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">PnL by execution latency</div>
          <div className="text-[11px] text-text-muted">
            Total simulated net profit at each reaction-latency scenario.
          </div>
        </div>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
            />
            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1f2937' }}
              width={48}
              domain={[Math.min(minPnL * 1.1, 0), Math.max(maxPnL * 1.15, 0.5)]}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(95,210,255,0.05)' }} />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {data.map((d) => (
                <Cell
                  key={d.label}
                  fill={d.pnl >= 0 ? '#5af5a8' : '#f47272'}
                  fillOpacity={0.78}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { label: string; pnl: number; trades: number; rejected: number };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="metric-label mb-1">Latency {p.label}</div>
      <div className="mono text-base text-signal-positive">{fmtUSDTSigned(p.pnl)} USDT</div>
      <div className="mt-1 text-text-secondary">
        Trades: <span className="mono text-text-primary">{fmtInt(p.trades)}</span>
      </div>
      <div className="text-text-secondary">
        Rejected: <span className="mono text-text-primary">{fmtInt(p.rejected)}</span>
      </div>
    </div>
  );
}
