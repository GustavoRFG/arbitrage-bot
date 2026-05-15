import type { Database as BetterDb } from 'better-sqlite3';

import type { ScannerRun } from '../../core/run-context/scanner-run.js';

export class ScannerRunRepository {
  constructor(private readonly db: BetterDb) {}

  insert(run: ScannerRun): void {
    this.db
      .prepare(
        `INSERT INTO scanner_runs(run_id, mode, started_at, ended_at, config_hash, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.mode,
        run.startedAtMs,
        run.endedAtMs ?? null,
        run.configHash,
        run.status,
        run.notes ?? null,
      );
  }

  finalize(run: ScannerRun): void {
    this.db
      .prepare(
        `UPDATE scanner_runs
         SET ended_at = ?, status = ?, notes = COALESCE(?, notes)
         WHERE run_id = ?`,
      )
      .run(run.endedAtMs ?? null, run.status, run.notes ?? null, run.runId);
  }
}
