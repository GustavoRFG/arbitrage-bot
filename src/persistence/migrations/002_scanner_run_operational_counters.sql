-- Add run completion status and operational counters.
--
-- SQLite cannot widen a CHECK constraint in place, so this rebuilds only the
-- scanner_runs table. Migration execution disables FK enforcement while the
-- parent table is swapped, then restores it afterward.

CREATE TABLE scanner_runs_new (
    run_id                      TEXT PRIMARY KEY,
    mode                        TEXT NOT NULL CHECK (mode IN ('cex', 'polymarket', 'all')),
    started_at                  INTEGER NOT NULL,
    ended_at                    INTEGER,
    config_hash                 TEXT NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted')),
    notes                       TEXT,
    total_cycles                INTEGER NOT NULL DEFAULT 0,
    total_symbols_scanned       INTEGER NOT NULL DEFAULT 0,
    total_candidates            INTEGER NOT NULL DEFAULT 0,
    total_material_candidates   INTEGER NOT NULL DEFAULT 0,
    actual_elapsed_ms           INTEGER
);

INSERT INTO scanner_runs_new(
    run_id, mode, started_at, ended_at, config_hash, status, notes,
    total_cycles, total_symbols_scanned, total_candidates,
    total_material_candidates, actual_elapsed_ms
)
SELECT
    run_id,
    mode,
    started_at,
    ended_at,
    config_hash,
    status,
    notes,
    0,
    0,
    COALESCE((SELECT COUNT(*) FROM cex_arbitrage_candidates c WHERE c.run_id = scanner_runs.run_id), 0)
      + COALESCE((SELECT COUNT(*) FROM repricing_lag_candidates p WHERE p.run_id = scanner_runs.run_id), 0),
    0,
    CASE
      WHEN ended_at IS NOT NULL THEN ended_at - started_at
      ELSE NULL
    END
FROM scanner_runs;

DROP TABLE scanner_runs;

ALTER TABLE scanner_runs_new RENAME TO scanner_runs;

CREATE INDEX IF NOT EXISTS idx_scanner_runs_started_at ON scanner_runs(started_at);
