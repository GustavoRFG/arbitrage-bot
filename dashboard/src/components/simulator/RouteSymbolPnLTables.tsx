import type { RoutePnLRow, SymbolPnLRow } from '@/lib/queries/simulator';
import { fmtInt, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';
import { LeaderboardBar } from '../charts/LeaderboardBar';

export function RoutePnLTable({ rows }: { rows: RoutePnLRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">No paper trades on any route.</div>
    );
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.totalNetProfitQuote))) || 1;
  return (
    <div className="panel overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Route</th>
            <th className="text-right">Trades</th>
            <th>PnL share</th>
            <th className="text-right">Avg PnL</th>
            <th className="text-right">Total PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.buyVenue}|${r.sellVenue}`}>
              <td className="mono">
                <span className="text-text-primary">{r.buyVenue}</span>
                <span className="mx-1.5 text-text-muted">→</span>
                <span className="text-text-primary">{r.sellVenue}</span>
              </td>
              <td className="num">{fmtInt(r.trades)}</td>
              <td className="w-[28%]">
                <LeaderboardBar
                  value={Math.abs(r.totalNetProfitQuote)}
                  max={max}
                  accent={r.totalNetProfitQuote >= 0 ? 'mint' : 'coral'}
                />
              </td>
              <td className={`num ${pnlClass(r.avgNetProfitQuote)}`}>{fmtUSDT(r.avgNetProfitQuote)}</td>
              <td className={`num font-semibold ${pnlClass(r.totalNetProfitQuote)}`}>
                {fmtUSDTSigned(r.totalNetProfitQuote)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SymbolPnLTable({ rows }: { rows: SymbolPnLRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">No paper trades on any symbol.</div>
    );
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.totalNetProfitQuote))) || 1;
  return (
    <div className="panel overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="text-right">Trades</th>
            <th>PnL share</th>
            <th className="text-right">Avg PnL</th>
            <th className="text-right">Total PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td className="mono text-text-primary">{r.symbol}</td>
              <td className="num">{fmtInt(r.trades)}</td>
              <td className="w-[28%]">
                <LeaderboardBar
                  value={Math.abs(r.totalNetProfitQuote)}
                  max={max}
                  accent={r.totalNetProfitQuote >= 0 ? 'mint' : 'coral'}
                />
              </td>
              <td className={`num ${pnlClass(r.avgNetProfitQuote)}`}>{fmtUSDT(r.avgNetProfitQuote)}</td>
              <td className={`num font-semibold ${pnlClass(r.totalNetProfitQuote)}`}>
                {fmtUSDTSigned(r.totalNetProfitQuote)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
