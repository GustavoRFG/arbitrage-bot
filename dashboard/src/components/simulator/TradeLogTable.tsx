import type { PaperTradeRow } from '@/lib/queries/simulator';
import { fmtInt, fmtMs, fmtPct, fmtTime, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';

export function TradeLogTable({ trades }: { trades: PaperTradeRow[] }) {
  if (trades.length === 0) {
    return (
      <div className="panel p-4 text-sm text-text-secondary">
        No paper trades were executed for this simulation scenario.
      </div>
    );
  }
  return (
    <div className="panel overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Symbol</th>
            <th>Route</th>
            <th className="text-right">Latency</th>
            <th className="text-right">Notional</th>
            <th className="text-right">Base qty</th>
            <th className="text-right">Net spread</th>
            <th className="text-right">Net profit</th>
            <th className="text-right">Lifecycle</th>
            <th>Policy</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td className="num text-text-muted">{fmtTime(t.executedAtMs)}</td>
              <td className="mono text-text-primary">{t.symbol}</td>
              <td className="mono text-text-secondary">
                {t.buyVenue} <span className="mx-1 text-text-muted">→</span> {t.sellVenue}
              </td>
              <td className="num text-text-secondary">{fmtMs(t.latencyMs)}</td>
              <td className="num">{fmtUSDT(t.targetNotionalQuote, 0)}</td>
              <td className="num text-text-secondary">{fmtInt(t.baseQty)}</td>
              <td className="num text-accent-cyan">{fmtPct(t.netSpreadPct)}</td>
              <td className={`num font-semibold ${pnlClass(t.netProfitQuote)}`}>
                {fmtUSDTSigned(t.netProfitQuote)}
              </td>
              <td className="num text-text-muted">#{t.lifecycleId}</td>
              <td className="mono text-[11px] text-text-secondary">{t.policyName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
