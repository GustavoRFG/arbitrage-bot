-- =============================================================================
-- Phase 2 — Prefunded Paper Execution Simulator
-- =============================================================================
-- Replays Observatory-detected cross-exchange arbitrage opportunities under a
-- configurable policy (latency, thresholds, prefunded inventory) and stores
-- both the simulation invocation and every paper trade it produced.
--
-- One row in `paper_simulation_runs` corresponds to ONE invocation of the
-- simulator against ONE scanner run with ONE latency scenario. A single CLI
-- call with multiple --latencies produces multiple simulation runs that share
-- the same `source_scanner_run_id`.

CREATE TABLE IF NOT EXISTS paper_simulation_runs (
    simulation_run_id           TEXT PRIMARY KEY,
    source_scanner_run_id       TEXT NOT NULL,
    created_at                  INTEGER NOT NULL,
    policy_name                 TEXT NOT NULL,
    selection_mode              TEXT NOT NULL,
    latency_ms                  INTEGER NOT NULL,
    min_profit_quote            REAL NOT NULL,
    min_spread_pct              REAL NOT NULL,
    max_notional_quote          REAL NOT NULL,
    reentry_cooldown_ms         INTEGER,
    symbols_filter_json         TEXT,
    routes_filter_json          TEXT,
    initial_portfolio_json      TEXT NOT NULL,
    final_portfolio_json        TEXT NOT NULL,
    eligible_lifecycles         INTEGER NOT NULL,
    total_trades                INTEGER NOT NULL,
    total_rejected              INTEGER NOT NULL,
    rejections_json             TEXT NOT NULL,
    total_net_profit_quote      REAL NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    notes                       TEXT,
    FOREIGN KEY (source_scanner_run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_sim_runs_source
    ON paper_simulation_runs(source_scanner_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_sim_runs_created
    ON paper_simulation_runs(created_at);

CREATE TABLE IF NOT EXISTS paper_arbitrage_trades (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_run_id           TEXT NOT NULL,
    lifecycle_id                INTEGER NOT NULL,
    candidate_id                INTEGER,
    estimate_id                 INTEGER,
    symbol                      TEXT NOT NULL,
    buy_venue                   TEXT NOT NULL,
    sell_venue                  TEXT NOT NULL,
    detected_at                 INTEGER NOT NULL,
    executed_at                 INTEGER NOT NULL,
    latency_ms                  INTEGER NOT NULL,
    target_notional_quote       REAL NOT NULL,
    executable_buy_notional     REAL NOT NULL,
    executable_sell_notional    REAL NOT NULL,
    base_qty                    REAL NOT NULL,
    avg_buy_price               REAL NOT NULL,
    avg_sell_price              REAL NOT NULL,
    fees_quote                  REAL NOT NULL,
    net_profit_quote            REAL NOT NULL,
    net_spread_pct              REAL NOT NULL,
    buy_quote_delta             REAL NOT NULL,
    buy_base_delta              REAL NOT NULL,
    sell_base_delta             REAL NOT NULL,
    sell_quote_delta            REAL NOT NULL,
    policy_name                 TEXT NOT NULL,
    FOREIGN KEY (simulation_run_id) REFERENCES paper_simulation_runs(simulation_run_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_sim
    ON paper_arbitrage_trades(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_lifecycle
    ON paper_arbitrage_trades(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol
    ON paper_arbitrage_trades(symbol);
