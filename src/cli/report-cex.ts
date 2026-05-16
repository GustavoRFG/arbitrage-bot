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

function fmtPct(n: number): string {
  return `${fmtNum(n, 4)}%`;
}

function fmtTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'open';
  return new Date(ms).toISOString();
}

function fmtRatio(numerator: number, denominator: number): string {
  return `${numerator} / ${denominator}`;
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
  lines.push(`Runs:                                              ${sum.totalRuns}`);
  lines.push(`Order book snapshots persisted:                    ${sum.totalSnapshots}`);
  lines.push('');
  lines.push('Counting layers (distinct units — do not sum across rows):');
  lines.push(
    `  Raw cross-exchange candidates:                   ${sum.rawCandidates}`,
  );
  lines.push(
    `    of which approx. net-positive after fees:      ${sum.candidatesNetPositiveAfterFees}`,
  );
  lines.push(
    `  Depth estimates calculated:                      ${sum.depthEstimatesCalculated}`,
  );
  lines.push(
    `    depth-supported @ $100:                        ${sum.depthSupportedAt100}`,
  );
  lines.push(
    `    depth-supported @ $500:                        ${sum.depthSupportedAt500}`,
  );
  lines.push(
    `  Tradable estimates under prefunded assumption:   ${fmtRatio(
      sum.tradableEstimatesPrefunded,
      sum.depthEstimatesCalculated,
    )}`,
  );
  lines.push(
    `  Distinct opportunity lifecycles:                 ${sum.distinctOpportunityLifecycles}`,
  );
  lines.push(
    `    single-observation lifecycles:                 ${sum.singleObservationLifecycles}`,
  );
  lines.push(
    `    multi-observation lifecycles:                  ${sum.multiObservationLifecycles}`,
  );
  lines.push('');
  lines.push(`Max simulated net profit (quote):                  ${fmtNum(sum.maxNetProfitQuote)}`);
  lines.push(`Median simulated net profit (quote):               ${fmtNum(sum.medianNetProfitQuote)}`);
  lines.push(`Longest opportunity lifecycle (ms):                ${sum.longestLifecycleMs}`);
  lines.push(`Median opportunity lifecycle (ms):                 ${sum.medianLifecycleMs}`);
  lines.push(
    `Best route (by raw candidates):                    ${
      sum.topRoute ? `${sum.topRoute.buyExchange} -> ${sum.topRoute.sellExchange} (${sum.topRoute.count})` : '—'
    }`,
  );
  lines.push(
    `Best symbol (by raw candidates):                   ${
      sum.topSymbol ? `${sum.topSymbol.symbol} (${sum.topSymbol.count})` : '—'
    }`,
  );

  lines.push('');
  lines.push('Per symbol (candidates / depth-estimates / tradable-estimates / lifecycles):');
  for (const r of symbols.slice(0, 20)) {
    lines.push(
      `  ${r.symbol.padEnd(12)} candidates=${String(r.rawCandidates).padStart(6)}` +
        `  depthEstimates=${String(r.depthEstimates).padStart(6)}` +
        `  tradableEstimates=${String(r.tradableEstimates).padStart(6)}` +
        `  lifecycles=${String(r.lifecycles).padStart(5)}`,
    );
  }

  lines.push('');
  lines.push('Per route, buy -> sell (candidates / depth-estimates / tradable-estimates / lifecycles):');
  for (const r of routes.slice(0, 20)) {
    lines.push(
      `  ${r.buyExchange.padEnd(8)} -> ${r.sellExchange.padEnd(8)}` +
        ` candidates=${String(r.rawCandidates).padStart(6)}` +
        `  depthEstimates=${String(r.depthEstimates).padStart(6)}` +
        `  tradableEstimates=${String(r.tradableEstimates).padStart(6)}` +
        `  lifecycles=${String(r.lifecycles).padStart(5)}`,
    );
  }

  lines.push('');
  lines.push('Top 10 lifecycle audit (longest first):');
  for (const l of lifecycles) {
    const bestEstimate = l.bestEstimate
      ? `bestEstimate=estimate#${l.bestEstimate.estimateId} candidate#${l.bestEstimate.candidateId}` +
        ` detected=${fmtTs(l.bestEstimate.detectedAtMs)}` +
        ` target=${fmtNum(l.bestEstimate.targetNotionalQuote, 0)}` +
        ` netProfit=${fmtNum(l.bestEstimate.netProfitQuote)}` +
        ` netSpread=${fmtPct(l.bestEstimate.netSpreadPct)}` +
        ` depth=${l.bestEstimate.supportedByDepth ? 'yes' : 'no'}` +
        ` prefunded=${l.bestEstimate.tradablePrefunded ? 'yes' : 'no'}`
      : 'bestEstimate=none-attached';

    lines.push(
      `  lifecycle#${l.id} ${l.symbol} ${l.buyExchange}->${l.sellExchange} ` +
        `status=${l.status} dur=${l.effectiveDurationMs}ms obs=${l.observationCount}`,
    );
    lines.push(`    eventKey=${l.eventKey}`);
    lines.push(
      `    firstSeen=${fmtTs(l.firstSeenAtMs)} lastSeen=${fmtTs(l.lastSeenAtMs)} ended=${fmtTs(l.endedAtMs)}`,
    );
    lines.push(
      `    bestObservedNetSpread=${fmtPct(l.maxApproxNetSpreadPct)} ` +
        `bestObservedGrossSpread=${fmtPct(l.maxGrossSpreadPct)} ` +
        `lifecycleMaxProfit=${fmtNum(l.maxNetProfitQuote)} ` +
        `lifecycleMaxNotional=${fmtNum(l.maxSupportedNotionalQuote)}`,
    );
    lines.push(`    ${bestEstimate}`);
  }

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
