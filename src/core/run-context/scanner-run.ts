import { createHash } from 'node:crypto';

import { getLogger } from '../logger/logger.js';
import { nowMs } from '../types/timestamps.js';

export type ScannerMode = 'cex' | 'polymarket' | 'all';

export interface ScannerRun {
  runId: string;
  mode: ScannerMode;
  startedAtMs: number;
  endedAtMs?: number;
  configHash: string;
  status: 'running' | 'completed' | 'aborted' | 'failed' | 'interrupted';
  notes?: string;
  totalCycles: number;
  totalSymbolsScanned: number;
  totalCandidates: number;
  totalMaterialCandidates: number;
  actualElapsedMs?: number;
  /** JSON-serialised universe + material rule descriptor (see ScannerRunUniverse). */
  universeJson?: string;
}

/** Auxiliary metadata captured at startup so reports can recover the scan
 * universe and rule without re-reading the config that was active back then. */
export interface ScannerRunUniverse {
  symbolMode: 'fixed' | 'curated' | 'intersection';
  enabledExchanges: string[];
  resolvedSymbols: string[];
  minVenuesPerSymbol: number;
  maxSymbols: number;
  truncated: boolean;
  materialRule: {
    minNetProfitQuote: number;
    minExecutableNetSpreadPct: number;
    description: string;
  };
}

/** Produce a deterministic short hash of a config object for run audit. */
export function hashConfig(config: object): string {
  const canonical = JSON.stringify(config, Object.keys(config).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function newRunId(mode: ScannerMode): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${mode}_${rand}`;
}

export function startRun(mode: ScannerMode, configHash: string): ScannerRun {
  const run: ScannerRun = {
    runId: newRunId(mode),
    mode,
    startedAtMs: nowMs(),
    configHash,
    status: 'running',
    totalCycles: 0,
    totalSymbolsScanned: 0,
    totalCandidates: 0,
    totalMaterialCandidates: 0,
  };
  getLogger('run').info({ runId: run.runId, mode, configHash }, 'scanner run started');
  return run;
}

export function endRun(
  run: ScannerRun,
  status: 'completed' | 'aborted' | 'failed' | 'interrupted',
  notes?: string,
): ScannerRun {
  run.endedAtMs = nowMs();
  run.status = status;
  run.actualElapsedMs = run.endedAtMs - run.startedAtMs;
  if (notes !== undefined) run.notes = notes;
  getLogger('run').info(
    { runId: run.runId, status, durationMs: run.endedAtMs - run.startedAtMs },
    'scanner run ended',
  );
  return run;
}
