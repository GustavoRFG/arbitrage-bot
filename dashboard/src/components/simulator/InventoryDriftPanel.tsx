import clsx from 'clsx';
import { fmtAsset } from '@/lib/format';
import type { PortfolioBalances } from '@/lib/queries/simulator';

export interface InventoryDriftPanelProps {
  initial: PortfolioBalances;
  final: PortfolioBalances;
  drift: PortfolioBalances;
}

export function InventoryDriftPanel({ initial, final, drift }: InventoryDriftPanelProps) {
  const venues = Array.from(
    new Set([...Object.keys(initial), ...Object.keys(final), ...Object.keys(drift)]),
  ).sort();

  if (venues.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">
        No portfolio snapshots persisted for this simulation.
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="metric-label">Inventory drift by venue</div>
          <div className="text-[11px] text-text-muted">
            Per-venue change in balances after the simulated trades. USDT inflows mark sell
            venues; base inflows mark buy venues.
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {venues.map((venue) => {
          const initialV = initial[venue] ?? {};
          const finalV = final[venue] ?? {};
          const driftV = drift[venue] ?? {};
          const assets = Array.from(
            new Set([...Object.keys(initialV), ...Object.keys(finalV), ...Object.keys(driftV)]),
          ).sort();
          if (assets.length === 0) return null;
          return (
            <div key={venue} className="panel-tight p-3">
              <div className="mb-2 flex items-baseline justify-between border-b border-border-subtle pb-1.5">
                <span className="mono text-sm font-semibold text-text-primary">{venue}</span>
                <span className="metric-label">drift</span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {assets.map((asset) => {
                    const i = initialV[asset] ?? 0;
                    const f = finalV[asset] ?? 0;
                    const d = driftV[asset] ?? f - i;
                    if (Math.abs(d) < 1e-6 && i === 0 && f === 0) return null;
                    return (
                      <tr key={asset} className="border-b border-border-subtle/40 last:border-0">
                        <td className="py-1.5 pr-2 text-text-muted">{asset}</td>
                        <td className="num py-1.5 text-text-secondary">{fmtAsset(i, asset)}</td>
                        <td className="num py-1.5 text-text-secondary">{fmtAsset(f, asset)}</td>
                        <td
                          className={clsx(
                            'num py-1.5 font-semibold',
                            d > 0
                              ? 'text-signal-positive'
                              : d < 0
                                ? 'text-signal-negative'
                                : 'text-text-faint',
                          )}
                        >
                          {d > 0 ? '+' : d < 0 ? '−' : ''}
                          {fmtAsset(Math.abs(d), asset)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
