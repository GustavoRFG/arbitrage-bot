-- =============================================================================
-- Phase 2.6 — Paper Comparison Persistence
-- =============================================================================
-- Stores the output of `paper:cex:compare` so the dashboard can read the
-- same preset × latency grid the CLI just printed. We use a "hybrid" shape
-- (two tables + JSON blobs per scenario) instead of fully normalizing
-- everything: the top-N tables, route aggregates, drift, and missed-by-reason
-- maps are already structured by the comparison service and are cheap to
-- ship as JSON for read-only dashboard consumption.
--
-- Each call to the CLI writes ONE row in paper_comparison_runs and one row
-- per (preset × latency) cell in paper_comparison_scenarios. Re-running the
-- CLI produces a new comparison_run_id; older comparisons are kept for
-- history (the dashboard picks the latest by default).

CREATE TABLE IF NOT EXISTS paper_comparison_runs (
    comparison_run_id          TEXT PRIMARY KEY,
    source_scanner_run_id      TEXT NOT NULL,
    created_at                 INTEGER NOT NULL,
    label                      TEXT,
    policy_name                TEXT NOT NULL,
    selection_mode             TEXT NOT NULL,
    min_profit_quote           REAL NOT NULL,
    min_spread_pct             REAL NOT NULL,
    max_notional_quote         REAL NOT NULL,
    reentry_cooldown_ms        INTEGER,
    contention_mode            TEXT NOT NULL CHECK (contention_mode IN ('single_route', 'multi_route')),
    latencies_json             TEXT NOT NULL,
    presets_json               TEXT NOT NULL,
    symbols_filter_json        TEXT,
    routes_filter_json         TEXT,
    eligible_lifecycles        INTEGER NOT NULL,
    cell_count                 INTEGER NOT NULL,
    best_total_net_profit_quote REAL,
    best_preset                TEXT,
    best_latency_ms            INTEGER,
    total_missed_profit_quote  REAL,
    top_bottleneck_reason      TEXT,
    notes                      TEXT,
    FOREIGN KEY (source_scanner_run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_cmp_runs_source
    ON paper_comparison_runs(source_scanner_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_cmp_runs_created
    ON paper_comparison_runs(created_at);

CREATE TABLE IF NOT EXISTS paper_comparison_scenarios (
    scenario_id                INTEGER PRIMARY KEY AUTOINCREMENT,
    comparison_run_id          TEXT NOT NULL,
    simulation_run_id          TEXT NOT NULL,
    preset_name                TEXT NOT NULL,
    preset_label               TEXT NOT NULL,
    latency_ms                 INTEGER NOT NULL,
    contention_mode            TEXT NOT NULL,
    executed_trades            INTEGER NOT NULL,
    total_net_profit_quote     REAL NOT NULL,
    total_missed_profit_quote  REAL NOT NULL,
    rejections_by_reason_json  TEXT NOT NULL,
    missed_profit_by_reason_json TEXT NOT NULL,
    top_bottleneck_reason      TEXT,
    initial_portfolio_json     TEXT NOT NULL,
    final_portfolio_json       TEXT NOT NULL,
    final_inventory_drift_json TEXT NOT NULL,
    top_executed_json          TEXT NOT NULL,
    top_missed_json            TEXT NOT NULL,
    top_routes_paper_pnl_json  TEXT NOT NULL,
    top_routes_missed_pnl_json TEXT NOT NULL,
    top_symbols_efficiency_json TEXT NOT NULL,
    FOREIGN KEY (comparison_run_id) REFERENCES paper_comparison_runs(comparison_run_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_cmp_scen_run
    ON paper_comparison_scenarios(comparison_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_cmp_scen_preset
    ON paper_comparison_scenarios(comparison_run_id, preset_name, latency_ms);
CREATE INDEX IF NOT EXISTS idx_paper_cmp_scen_pnl
    ON paper_comparison_scenarios(comparison_run_id, total_net_profit_quote);
