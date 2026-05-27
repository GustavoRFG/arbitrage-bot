import clsx from 'clsx';
import { fmtInt, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';
import type { ComparisonMatrix, ComparisonMatrixCell } from '@/lib/queries/comparison';

interface Props {
  matrix: ComparisonMatrix;
  selectedPreset?: string;
  selectedLatencyMs?: number;
}

function bottleneckHue(reason: string | null | undefined): string {
  if (!reason) return 'text-text-muted';
  if (
    reason === 'insufficient_base_inventory' ||
    reason === 'insufficient_quote_inventory'
  ) {
    return 'text-accent-amber';
  }
  if (reason === 'latency_expired' || reason === 'lifecycle_too_short_for_latency') {
    return 'text-accent-violet';
  }
  if (reason === 'below_threshold') return 'text-text-secondary';
  return 'text-text-secondary';
}

function shortBottleneckLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  switch (reason) {
    case 'insufficient_base_inventory':
      return 'base inv.';
    case 'insufficient_quote_inventory':
      return 'quote inv.';
    case 'lifecycle_too_short_for_latency':
      return 'lc < latency';
    case 'latency_expired':
      return 'latency expired';
    case 'below_threshold':
      return 'below threshold';
    case 'no_eligible_estimate':
      return 'no estimate';
    default:
      return reason;
  }
}

export function ComparisonMatrixGrid({ matrix, selectedPreset, selectedLatencyMs }: Props) {
  if (matrix.cells.length === 0) {
    return (
      <div className="panel grid h-[180px] place-items-center text-sm text-text-secondary">
        Comparison has no scenarios.
      </div>
    );
  }

  // Find the best PnL across the grid to color-scale cells.
  let bestPnl = -Infinity;
  for (const c of matrix.cells) if (c.totalNetProfitQuote > bestPnl) bestPnl = c.totalNetProfitQuote;

  // Index for O(1) lookup.
  const byKey = new Map<string, ComparisonMatrixCell>();
  for (const c of matrix.cells) byKey.set(`${c.presetName}|${c.latencyMs}`, c);

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="metric-label">Preset × latency matrix</div>
        <div className="text-[11px] text-text-muted">
          PnL · executed trades · missed PnL · top bottleneck.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted">
                Preset
              </th>
              {matrix.latencies.map((ms) => (
                <th
                  key={ms}
                  className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-text-muted"
                >
                  {ms}ms
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.presets.map((preset) => (
              <tr key={preset.name} className="border-b border-border-subtle/50">
                <td className="px-3 py-2 align-top">
                  <div className="text-xs font-semibold text-text-primary">{preset.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">
                    {preset.name}
                  </div>
                </td>
                {matrix.latencies.map((ms) => {
                  const cell = byKey.get(`${preset.name}|${ms}`);
                  const isSelected =
                    preset.name === selectedPreset && ms === selectedLatencyMs;
                  if (!cell) {
                    return (
                      <td key={ms} className="px-3 py-2 text-center text-text-muted">
                        —
                      </td>
                    );
                  }
                  const intensity =
                    bestPnl > 0
                      ? Math.max(0, Math.min(1, cell.totalNetProfitQuote / bestPnl))
                      : 0;
                  return (
                    <td
                      key={ms}
                      className={clsx(
                        'border-l border-border-subtle/40 px-3 py-2 align-top',
                        isSelected && 'bg-accent-cyan/5 ring-1 ring-inset ring-accent-cyan/40',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={clsx('mono text-sm font-semibold', pnlClass(cell.totalNetProfitQuote))}
                          style={{ opacity: 0.6 + 0.4 * intensity }}
                        >
                          {fmtUSDTSigned(cell.totalNetProfitQuote)}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {fmtInt(cell.executedTrades)} tr
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="text-text-muted">
                          missed{' '}
                          <span className="mono text-accent-amber/90">
                            {fmtUSDT(cell.totalMissedProfitQuote)}
                          </span>
                        </span>
                        <span className={clsx('uppercase tracking-wider', bottleneckHue(cell.topBottleneckReason))}>
                          {shortBottleneckLabel(cell.topBottleneckReason)}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
