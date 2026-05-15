#!/usr/bin/env node
import { getLogger } from '../core/logger/logger.js';
import { CexScanOrchestrator } from '../services/cex-arbitrage/cex-scan-orchestrator.js';

const log = getLogger('cli.scan-cex');

function parseDuration(arg: string | undefined): number | undefined {
  if (!arg) return undefined;
  const m = arg.match(/^--duration=(\d+)(ms|s|m|h)?$/);
  if (!m) {
    throw new Error(`Invalid --duration: ${arg} (try --duration=10m, --duration=2h, --duration=30s)`);
  }
  const n = Number(m[1]);
  switch (m[2] ?? 'ms') {
    case 'ms': return n;
    case 's': return n * 1_000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    default: return n;
  }
}

async function main(): Promise<void> {
  const durationArg = process.argv.find((a) => a.startsWith('--duration='));
  const durationMs = parseDuration(durationArg);
  log.info({ durationMs: durationMs ?? 'unbounded (Ctrl+C to stop)' }, 'starting CEX scan');

  const orchestrator = new CexScanOrchestrator();
  const opts: { durationMs?: number } = {};
  if (durationMs !== undefined) opts.durationMs = durationMs;
  const run = await orchestrator.run(opts);
  log.info({ runId: run.runId, status: run.status }, 'CEX scan finished');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
