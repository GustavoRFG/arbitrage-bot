'use client';
import type { SymbolBreakdown } from '@/lib/queries/observatory';
import { fmtDuration, fmtInt, fmtUSDT } from '@/lib/format';
import { LeaderboardBar } from '../charts/LeaderboardBar';

export function SymbolLeaderboard({
  rows,
  limit = 12,
}: {
  rows: SymbolBreakdown[];
  limit?: number;
}) {
  const top = rows.slice(0, limit);
  const max = top.reduce((acc, r) => Math.max(acc, r.rawCandidates), 0) || 1;

  if (top.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">
        No symbols observed yet for this run.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="text-right">Candidates</th>
            <th>Share</th>
            <th className="text-right">Tradable</th>
            <th className="text-right">Lifecycles</th>
            <th className="text-right">Max duration</th>
            <th className="text-right">Max net profit</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r) => (
            <tr key={r.symbol}>
              <td className="mono text-text-primary">{r.symbol}</td>
              <td className="num">{fmtInt(r.rawCandidates)}</td>
              <td className="w-[28%]">
                <LeaderboardBar value={r.rawCandidates} max={max} accent="cyan" />
              </td>
              <td className="num text-signal-positive">{fmtInt(r.tradableEstimates)}</td>
              <td className="num">{fmtInt(r.lifecycles)}</td>
              <td className="num text-text-secondary">{fmtDuration(r.maxLifecycleMs)}</td>
              <td className="num text-accent-mint">{fmtUSDT(r.maxNetProfitQuote)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
