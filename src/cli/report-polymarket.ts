#!/usr/bin/env node
import { getDb } from '../persistence/db.js';
import { PolymarketReportService } from '../services/polymarket-repricing/polymarket-report-service.js';

function findRunIdArg(): string | undefined {
  const a = process.argv.find((x) => x.startsWith('--run='));
  return a ? a.slice('--run='.length) : undefined;
}

async function main(): Promise<void> {
  const reports = new PolymarketReportService(getDb());
  const runId = findRunIdArg();
  const sum = reports.summary(runId);

  const lines: string[] = [];
  lines.push('POLYMARKET REPRICING OBSERVATORY — REPORT');
  lines.push('-----------------------------------------');
  lines.push(`Scope: ${runId ? `run ${runId}` : 'all runs'}`);
  lines.push(`Markets discovered:                  ${sum.totalMarkets}`);
  lines.push(`Reference snapshots persisted:       ${sum.totalReferenceSnapshots}`);
  lines.push(`Polymarket book snapshots persisted: ${sum.totalClobSnapshots}`);
  lines.push(`Feature snapshots persisted:         ${sum.totalFeatureSnapshots}`);
  lines.push(`Repricing-lag candidates emitted:    ${sum.totalCandidates}`);
  lines.push(`Median lag estimate (ms):            ${sum.medianLagMs}`);
  lines.push(`Max lag estimate (ms):               ${sum.maxLagMs}`);
  lines.push(`Longest lifecycle duration (ms):     ${sum.longestLifecycleMs}`);

  lines.push('');
  lines.push('Candidates by event type:');
  if (sum.candidatesByType.length === 0) {
    lines.push('  (none yet — Polymarket adapters are stubs in this build)');
  } else {
    for (const e of sum.candidatesByType) {
      lines.push(`  ${e.eventType.padEnd(36)} ${e.n}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
