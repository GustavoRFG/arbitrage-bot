#!/usr/bin/env node
import { getDb } from '../persistence/db.js';
import { CexReportService } from '../services/cex-arbitrage/cex-report-service.js';

function findRunIdArg(): string | undefined {
  const a = process.argv.find((x) => x.startsWith('--run='));
  return a ? a.slice('--run='.length) : undefined;
}

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

async function main(): Promise<void> {
  const reports = new CexReportService(getDb());
  const runId = findRunIdArg();
  const sum = reports.summary(runId);
  const symbols = reports.bySymbol(runId);
  const routes = reports.byRoute(runId);
  const lifecycles = reports.topLifecycles(10, runId);

  const lines: string[] = [];
  lines.push('CEX ARBITRAGE OBSERVATORY — REPORT');
  lines.push('-----------------------------------');
  lines.push(`Scope: ${runId ? `run ${runId}` : 'all runs'}`);
  lines.push(`Runs:                                ${sum.totalRuns}`);
  lines.push(`Order book snapshots persisted:      ${sum.totalSnapshots}`);
  lines.push(`Raw cross-exchange candidates:       ${sum.totalCandidates}`);
  lines.push(`Approx. net-positive after fees:     ${sum.candidatesNetPositiveAfterFees}`);
  lines.push(`Estimates calculated:                ${sum.totalEstimates}`);
  lines.push(`Depth-supported @ $100:              ${sum.depthSupportedAt100}`);
  lines.push(`Depth-supported @ $500:              ${sum.depthSupportedAt500}`);
  lines.push(`Tradable-under-prefunded:            ${sum.tradablePrefunded}`);
  lines.push(`Max simulated net profit (quote):    ${fmtNum(sum.maxNetProfitQuote)}`);
  lines.push(`Median simulated net profit (quote): ${fmtNum(sum.medianNetProfitQuote)}`);
  lines.push(`Longest opportunity lifecycle (ms):  ${sum.longestLifecycleMs}`);
  lines.push(`Median opportunity lifecycle (ms):   ${sum.medianLifecycleMs}`);
  lines.push(
    `Best route:                          ${
      sum.topRoute ? `${sum.topRoute.buyExchange} -> ${sum.topRoute.sellExchange} (${sum.topRoute.count})` : '—'
    }`,
  );
  lines.push(
    `Best symbol:                         ${
      sum.topSymbol ? `${sum.topSymbol.symbol} (${sum.topSymbol.count})` : '—'
    }`,
  );

  lines.push('');
  lines.push('Per symbol:');
  for (const r of symbols.slice(0, 20)) {
    lines.push(`  ${r.symbol.padEnd(12)} candidates=${String(r.candidates).padStart(6)}  tradable=${r.tradable ?? 0}`);
  }

  lines.push('');
  lines.push('Per route (buy -> sell):');
  for (const r of routes.slice(0, 20)) {
    lines.push(`  ${r.buyExchange.padEnd(8)} -> ${r.sellExchange.padEnd(8)} candidates=${r.candidates}`);
  }

  lines.push('');
  lines.push('Top 10 longest lifecycles:');
  for (const l of lifecycles) {
    lines.push(
      `  ${l.symbol.padEnd(10)} ${l.buyExchange}->${l.sellExchange} ` +
        `dur=${l.durationMs ?? 'open'}ms  obs=${l.observationCount}  ` +
        `maxProfit=${fmtNum(l.maxNetProfitQuote)}  maxNotional=${fmtNum(l.maxSupportedNotionalQuote)}`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
