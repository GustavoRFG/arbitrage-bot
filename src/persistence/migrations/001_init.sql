-- =============================================================================
-- Market Inefficiency Observatory — Phase 1 schema
-- =============================================================================
-- Designed for SQLite (better-sqlite3). All timestamps are stored as INTEGER
-- milliseconds since epoch so no timezone conversion happens at the storage
-- layer. JSON columns hold raw or auxiliary payloads.

-- ----------------------------------------------------------------------------
-- Shared
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scanner_runs (
    run_id        TEXT PRIMARY KEY,
    mode          TEXT NOT NULL CHECK (mode IN ('cex', 'polymarket', 'all')),
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    config_hash   TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed')),
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_scanner_runs_started_at ON scanner_runs(started_at);

-- ----------------------------------------------------------------------------
-- CEX track
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cex_order_book_snapshots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id             TEXT NOT NULL,
    exchange           TEXT NOT NULL,
    symbol             TEXT NOT NULL,
    source_timestamp   INTEGER,
    received_at        INTEGER NOT NULL,
    processed_at       INTEGER,
    top_bid            REAL,
    top_ask            REAL,
    depth_levels       INTEGER NOT NULL,
    depth_json         TEXT,
    raw_json           TEXT,
    FOREIGN KEY (run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_cex_book_run_symbol_ex ON cex_order_book_snapshots(run_id, symbol, exchange);
CREATE INDEX IF NOT EXISTS idx_cex_book_received_at ON cex_order_book_snapshots(received_at);

CREATE TABLE IF NOT EXISTS cex_arbitrage_candidates (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                        TEXT NOT NULL,
    symbol                        TEXT NOT NULL,
    buy_exchange                  TEXT NOT NULL,
    sell_exchange                 TEXT NOT NULL,
    detected_at                   INTEGER NOT NULL,
    buy_top_ask                   REAL NOT NULL,
    sell_top_bid                  REAL NOT NULL,
    gross_spread_pct              REAL NOT NULL,
    approximate_net_spread_pct    REAL NOT NULL,
    lifecycle_id                  INTEGER,
    FOREIGN KEY (run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_cex_cand_run ON cex_arbitrage_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_cex_cand_symbol_route
    ON cex_arbitrage_candidates(symbol, buy_exchange, sell_exchange);

CREATE TABLE IF NOT EXISTS cex_opportunity_estimates (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id                INTEGER NOT NULL,
    target_notional_quote       REAL NOT NULL,
    avg_buy_price               REAL NOT NULL,
    avg_sell_price              REAL NOT NULL,
    executable_buy_notional     REAL NOT NULL,
    executable_sell_notional    REAL NOT NULL,
    supported_by_depth          INTEGER NOT NULL,   -- 0/1
    gross_profit_quote          REAL NOT NULL,
    fees_quote                  REAL NOT NULL,
    net_profit_quote            REAL NOT NULL,
    net_spread_pct              REAL NOT NULL,
    tradable_prefunded          INTEGER NOT NULL,   -- 0/1
    FOREIGN KEY (candidate_id) REFERENCES cex_arbitrage_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_cex_estimates_candidate ON cex_opportunity_estimates(candidate_id);

CREATE TABLE IF NOT EXISTS cex_arbitrage_lifecycles (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                          TEXT NOT NULL,
    event_key                       TEXT NOT NULL,
    symbol                          TEXT NOT NULL,
    buy_exchange                    TEXT NOT NULL,
    sell_exchange                   TEXT NOT NULL,
    first_seen_at                   INTEGER NOT NULL,
    last_seen_at                    INTEGER NOT NULL,
    ended_at                        INTEGER,
    duration_ms                     INTEGER,
    observation_count               INTEGER NOT NULL,
    status                          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    max_gross_spread_pct            REAL NOT NULL,
    max_approximate_net_spread_pct  REAL NOT NULL,
    max_net_profit_quote            REAL NOT NULL DEFAULT 0,
    max_supported_notional_quote    REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_cex_lifecycle_run ON cex_arbitrage_lifecycles(run_id);
CREATE INDEX IF NOT EXISTS idx_cex_lifecycle_event_key ON cex_arbitrage_lifecycles(event_key);
CREATE INDEX IF NOT EXISTS idx_cex_lifecycle_status ON cex_arbitrage_lifecycles(status);

-- ----------------------------------------------------------------------------
-- Polymarket track
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS polymarket_short_horizon_markets (
    id                      TEXT PRIMARY KEY,             -- internal id (e.g. condition_id or slug)
    slug                    TEXT,
    asset                   TEXT NOT NULL,                -- 'BTC' / 'ETH' / ...
    horizon                 TEXT NOT NULL,                -- '5m' / '15m'
    start_time              INTEGER NOT NULL,
    end_time                INTEGER NOT NULL,
    yes_token_id            TEXT,
    no_token_id             TEXT,
    reference_open_price    REAL,
    fees_enabled            INTEGER,                      -- 0/1, NULL = unknown
    fee_params_json         TEXT,
    tick_size               REAL,
    min_order_size          REAL,
    discovered_at           INTEGER NOT NULL,
    raw_metadata_json       TEXT
);

CREATE INDEX IF NOT EXISTS idx_poly_markets_asset_horizon
    ON polymarket_short_horizon_markets(asset, horizon, start_time);

CREATE TABLE IF NOT EXISTS crypto_reference_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT,
    asset               TEXT NOT NULL,
    source              TEXT NOT NULL CHECK (source IN ('binance', 'chainlink')),
    price               REAL NOT NULL,
    source_timestamp    INTEGER,
    received_at         INTEGER NOT NULL,
    processed_at        INTEGER,
    FOREIGN KEY (run_id) REFERENCES scanner_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_crypto_ref_asset_received_at
    ON crypto_reference_snapshots(asset, received_at);

CREATE TABLE IF NOT EXISTS polymarket_orderbook_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT,
    market_id           TEXT NOT NULL,
    token_side          TEXT NOT NULL CHECK (token_side IN ('YES', 'NO', 'BOTH')),
    source_timestamp    INTEGER,
    received_at         INTEGER NOT NULL,
    processed_at        INTEGER,
    best_bid            REAL,
    best_ask            REAL,
    midpoint            REAL,
    spread              REAL,
    depth_top_n_json    TEXT,
    book_hash           TEXT,
    FOREIGN KEY (market_id) REFERENCES polymarket_short_horizon_markets(id)
);

CREATE INDEX IF NOT EXISTS idx_poly_book_market_received_at
    ON polymarket_orderbook_snapshots(market_id, received_at);

CREATE TABLE IF NOT EXISTS polymarket_feature_snapshots (
    id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id                           TEXT NOT NULL,
    captured_at                         INTEGER NOT NULL,
    time_to_expiry_ms                   INTEGER,
    distance_from_open_binance_pct      REAL,
    distance_from_open_chainlink_pct    REAL,
    binance_chainlink_deviation_pct     REAL,
    yes_midpoint                        REAL,
    no_midpoint                         REAL,
    yes_spread                          REAL,
    no_spread                           REAL,
    yes_depth_metric                    REAL,
    no_depth_metric                     REAL,
    FOREIGN KEY (market_id) REFERENCES polymarket_short_horizon_markets(id)
);

CREATE INDEX IF NOT EXISTS idx_poly_feat_market_captured_at
    ON polymarket_feature_snapshots(market_id, captured_at);

CREATE TABLE IF NOT EXISTS repricing_lag_candidates (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                      TEXT,
    market_id                   TEXT NOT NULL,
    detected_at                 INTEGER NOT NULL,
    event_type                  TEXT NOT NULL,
    reference_source            TEXT NOT NULL,
    reference_move_pct          REAL,
    distance_from_open_pct      REAL,
    time_to_expiry_ms           INTEGER,
    clob_midpoint_before        REAL,
    clob_midpoint_current       REAL,
    lag_ms_estimate             INTEGER,
    liquidity_flag              TEXT,
    theoretical_edge_flag       INTEGER,    -- 0/1
    fee_assumptions_json        TEXT,
    notes                       TEXT,
    lifecycle_id                INTEGER,
    FOREIGN KEY (market_id) REFERENCES polymarket_short_horizon_markets(id)
);

CREATE INDEX IF NOT EXISTS idx_lag_candidates_market ON repricing_lag_candidates(market_id);
CREATE INDEX IF NOT EXISTS idx_lag_candidates_event_type ON repricing_lag_candidates(event_type);

CREATE TABLE IF NOT EXISTS repricing_lag_lifecycles (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                          TEXT,
    market_id                       TEXT NOT NULL,
    event_key                       TEXT NOT NULL,
    event_type                      TEXT NOT NULL,
    first_seen_at                   INTEGER NOT NULL,
    last_seen_at                    INTEGER NOT NULL,
    ended_at                        INTEGER,
    duration_ms                     INTEGER,
    observation_count               INTEGER NOT NULL,
    status                          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    max_reference_move_pct          REAL,
    max_distance_from_open_pct      REAL,
    max_lag_ms_estimate             INTEGER,
    repriced_flag                   INTEGER,             -- 0/1
    final_market_outcome            TEXT,                -- 'YES' / 'NO' / 'UNKNOWN'
    FOREIGN KEY (market_id) REFERENCES polymarket_short_horizon_markets(id)
);

CREATE INDEX IF NOT EXISTS idx_lag_lifecycle_event_key ON repricing_lag_lifecycles(event_key);
CREATE INDEX IF NOT EXISTS idx_lag_lifecycle_status ON repricing_lag_lifecycles(status);
