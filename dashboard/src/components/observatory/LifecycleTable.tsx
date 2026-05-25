import type { LifecycleAuditRow } from '@/lib/queries/observatory';
import { StatusBadge } from '../kpi/StatusBadge';
import { fmtDuration, fmtInt, fmtPct, fmtTime, fmtUSDT } from '@/lib/format';

export function LifecycleTable({ rows }: { rows: LifecycleAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">
        No lifecycles recorded for this scanner run yet.
      </div>
    );
  }
  return (
    <div className="panel overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Route</th>
            <th>Status</th>
            <th className="text-right">Duration</th>
            <th className="text-right">Obs</th>
            <th className="text-right">Max net spread</th>
            <th className="text-right">Max net profit</th>
            <th className="text-right">Best notional</th>
            <th className="text-right">First seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono text-text-primary">{r.symbol}</td>
              <td className="mono text-text-secondary">
                {r.buyExchange} <span className="mx-1 text-text-muted">→</span> {r.sellExchange}
              </td>
              <td>
                <StatusBadge status={r.status === 'open' ? 'running' : 'completed'} />
              </td>
              <td className="num text-text-primary">{fmtDuration(r.effectiveDurationMs)}</td>
              <td className="num">{fmtInt(r.observationCount)}</td>
              <td className="num text-accent-cyan">{fmtPct(r.maxApproxNetSpreadPct)}</td>
              <td className="num text-accent-mint">{fmtUSDT(r.maxNetProfitQuote)}</td>
              <td className="num text-text-secondary">{fmtInt(r.maxSupportedNotionalQuote)}</td>
              <td className="num text-text-muted">{fmtTime(r.firstSeenAtMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
