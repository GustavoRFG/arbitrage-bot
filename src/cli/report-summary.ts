#!/usr/bin/env node
import { getDb } from '../persistence/db.js';
import { CexReportService } from '../services/cex-arbitrage/cex-report-service.js';
import { PolymarketReportService } from '../services/polymarket-repricing/polymarket-report-service.js';

async function main(): Promise<void> {
  const db = getDb();
  const cex = new CexReportService(db).summary();
  const poly = new PolymarketReportService(db).summary();

  const lines: string[] = [];
  lines.push('MARKET INEFFICIENCY OBSERVATORY — RUN SUMMARY (all runs)');
  lines.push('--------------------------------------------------------');
  lines.push('');
  lines.push('[CEX ARBITRAGE]');
  lines.push(`Order book snapshots processed:                  ${cex.totalSnapshots}`);
  lines.push('Counting layers (distinct units — do not sum across rows):');
  lines.push(`  Raw cross-exchange candidates:                 ${cex.rawCandidates}`);
  lines.push(`    of which approx. net-positive after fees:    ${cex.candidatesNetPositiveAfterFees}`);
  lines.push(`  Depth estimates calculated:                    ${cex.depthEstimatesCalculated}`);
  lines.push(`    depth-supported @ $100:                      ${cex.depthSupportedAt100}`);
  lines.push(`    depth-supported @ $500:                      ${cex.depthSupportedAt500}`);
  lines.push(
    `  Tradable estimates under prefunded assumption: ${cex.tradableEstimatesPrefunded} / ${cex.depthEstimatesCalculated}`,
  );
  lines.push(`  Distinct opportunity lifecycles:               ${cex.distinctOpportunityLifecycles}`);
  lines.push(`    single-observation lifecycles:               ${cex.singleObservationLifecycles}`);
  lines.push(`    multi-observation lifecycles:                ${cex.multiObservationLifecycles}`);
  lines.push(`Median net profit (quote):                       ${cex.medianNetProfitQuote.toFixed(2)}`);
  lines.push(`Max net profit (quote):                          ${cex.maxNetProfitQuote.toFixed(2)}`);
  lines.push(`Longest lifecycle (ms):                          ${cex.longestLifecycleMs}`);
  lines.push(
    `Best route (by raw candidates):                  ${
      cex.topRoute ? `${cex.topRoute.buyExchange} -> ${cex.topRoute.sellExchange} (${cex.topRoute.count})` : '—'
    }`,
  );
  lines.push(
    `Best symbol (by raw candidates):                 ${
      cex.topSymbol ? `${cex.topSymbol.symbol} (${cex.topSymbol.count})` : '—'
    }`,
  );

  lines.push('');
  lines.push('[POLYMARKET REPRICING]');
  lines.push(`Markets tracked:                     ${poly.totalMarkets}`);
  lines.push(`Reference snapshots:                 ${poly.totalReferenceSnapshots}`);
  lines.push(`Polymarket book snapshots:           ${poly.totalClobSnapshots}`);
  lines.push(`Repricing-lag candidates:            ${poly.totalCandidates}`);
  if (poly.totalCandidates === 0) {
    lines.push('  (Polymarket adapters are stubs — see README for the integration TODO list)');
  } else {
    lines.push(`Median lag (ms):                     ${poly.medianLagMs}`);
    lines.push(`Max lag (ms):                        ${poly.maxLagMs}`);
  }

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
