import type { Database as BetterDb } from 'better-sqlite3';

import type { ScannerRun } from '../../core/run-context/scanner-run.js';

export class ScannerRunRepository {
  constructor(private readonly db: BetterDb) {}

  insert(run: ScannerRun): void {
    this.db
      .prepare(
        `INSERT INTO scanner_runs(
           run_id, mode, started_at, ended_at, config_hash, status, notes,
           total_cycles, total_symbols_scanned, total_candidates,
           total_material_candidates, actual_elapsed_ms, universe_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.mode,
        run.startedAtMs,
        run.endedAtMs ?? null,
        run.configHash,
        run.status,
        run.notes ?? null,
        run.totalCycles,
        run.totalSymbolsScanned,
        run.totalCandidates,
        run.totalMaterialCandidates,
        run.actualElapsedMs ?? null,
        run.universeJson ?? null,
      );
  }

  updateProgress(run: ScannerRun): void {
    this.db
      .prepare(
        `UPDATE scanner_runs
         SET total_cycles = ?,
             total_symbols_scanned = ?,
             total_candidates = ?,
             total_material_candidates = ?,
             actual_elapsed_ms = ?
         WHERE run_id = ?`,
      )
      .run(
        run.totalCycles,
        run.totalSymbolsScanned,
        run.totalCandidates,
        run.totalMaterialCandidates,
        run.actualElapsedMs ?? null,
        run.runId,
      );
  }

  finalize(run: ScannerRun): void {
    this.db
      .prepare(
        `UPDATE scanner_runs
         SET ended_at = ?,
             status = ?,
             notes = COALESCE(?, notes),
             total_cycles = ?,
             total_symbols_scanned = ?,
             total_candidates = ?,
             total_material_candidates = ?,
             actual_elapsed_ms = ?,
             universe_json = COALESCE(?, universe_json)
         WHERE run_id = ?`,
      )
      .run(
        run.endedAtMs ?? null,
        run.status,
        run.notes ?? null,
        run.totalCycles,
        run.totalSymbolsScanned,
        run.totalCandidates,
        run.totalMaterialCandidates,
        run.actualElapsedMs ?? null,
        run.universeJson ?? null,
        run.runId,
      );
  }
}
