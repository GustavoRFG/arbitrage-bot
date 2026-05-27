'use client';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtUSDTSigned } from '@/lib/format';
import type { ComparisonMatrix } from '@/lib/queries/comparison';

const PRESET_COLORS: Record<string, string> = {
  conservative: '#5fd2ff',
  moderate: '#22d3b9',
  aggressive: '#f59e0b',
  custom: '#a78bfa',
};

export function PnlByPresetLatencyChart({ matrix }: { matrix: ComparisonMatrix }) {
  if (matrix.cells.length === 0) {
    return (
      <div className="panel grid h-[300px] place-items-center text-sm text-text-secondary">
        No comparison cells to chart.
      </div>
    );
  }

  // Recharts wants one row per x value with one key per series.
  const data = matrix.latencies.map((ms) => {
    const row: Record<string, number | string> = { latency: ms, label: `${ms}ms` };
    for (const preset of matrix.presets) {
      const cell = matrix.cells.find(
        (c) => c.presetName === preset.name && c.latencyMs === ms,
      );
      row[preset.name] = Number((cell?.totalNetProfitQuote ?? 0).toFixed(4));
    }
    return row;
  });

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">PnL by preset × latency</div>
          <div className="text-[11px] text-text-muted">
            Total simulated net profit at each latency scenario, per inventory preset.
          </div>
        </div>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" vertical={false} />
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
              width={56}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(95,210,255,0.2)' }}
              contentStyle={{
                background: 'rgba(13,17,23,0.95)',
                border: '1px solid #1f2937',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name) => [`${fmtUSDTSigned(value)} USDT`, String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {matrix.presets.map((preset) => (
              <Line
                key={preset.name}
                type="monotone"
                dataKey={preset.name}
                name={preset.label}
                stroke={PRESET_COLORS[preset.name] ?? '#94a3b8'}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
