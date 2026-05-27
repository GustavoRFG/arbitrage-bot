import clsx from 'clsx';
import { fmtAsset, pnlClass } from '@/lib/format';
import type { PortfolioBalances } from '@/lib/queries/simulator';

interface Props {
  initial: PortfolioBalances;
  final: PortfolioBalances;
  drift: PortfolioBalances;
}

export function ComparisonInventoryDriftPanel({ initial, final, drift }: Props) {
  const venues = Array.from(
    new Set<string>([
      ...Object.keys(initial),
      ...Object.keys(final),
      ...Object.keys(drift),
    ]),
  ).sort();

  if (venues.length === 0) {
    return (
      <div className="panel grid h-[160px] place-items-center text-sm text-text-secondary">
        No inventory drift recorded for this scenario.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="metric-label">Final inventory drift</div>
        <div className="text-[11px] text-text-muted">
          Per-venue / per-asset change from start to end of the simulation.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                Venue
              </th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted">
                Asset
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                Initial
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                Final
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted">
                Drift
              </th>
            </tr>
          </thead>
          <tbody>
            {venues.map((venue) => {
              const assets = Array.from(
                new Set<string>([
                  ...Object.keys(initial[venue] ?? {}),
                  ...Object.keys(final[venue] ?? {}),
                  ...Object.keys(drift[venue] ?? {}),
                ]),
              ).sort();
              return assets.map((asset, idx) => {
                const initAmt = initial[venue]?.[asset] ?? 0;
                const finAmt = final[venue]?.[asset] ?? 0;
                const driftAmt = drift[venue]?.[asset] ?? finAmt - initAmt;
                return (
                  <tr
                    key={`${venue}-${asset}`}
                    className="border-b border-border-subtle/30 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 text-text-secondary">
                      {idx === 0 ? <span className="uppercase">{venue}</span> : ''}
                    </td>
                    <td className="px-3 py-1.5 text-text-primary mono">{asset}</td>
                    <td className="px-3 py-1.5 text-right mono text-text-secondary">
                      {fmtAsset(initAmt, asset)}
                    </td>
                    <td className="px-3 py-1.5 text-right mono text-text-secondary">
                      {fmtAsset(finAmt, asset)}
                    </td>
                    <td
                      className={clsx(
                        'px-3 py-1.5 text-right mono',
                        pnlClass(driftAmt),
                      )}
                    >
                      {fmtAsset(driftAmt, asset)}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
