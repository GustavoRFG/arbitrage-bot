# Arbitrage-Bot — Phase 1: Market Inefficiency Observatory

> **Phase 1 is observational and read-only. No orders are placed, no API keys
> are required, no wallets are touched.** The goal is to *first prove the edge
> exists in the data*, then decide if any track deserves paper trading.

Two empirical research tracks share one infrastructure:

1. **CEX Cross-Exchange Spot Arbitrage Observatory** — measures price
   disparities between centralised exchanges, *after fees and depth*.
2. **Polymarket Crypto Repricing Lag Observatory** *(skeleton)* — measures
   microdesfases between crypto reference feeds and Polymarket's CLOB on
   short-horizon contracts (BTC Up/Down 5m to start).

## What this build is, and is not

| Built in this build | Out of scope (Phase 1) |
|---|---|
| Read public order books from multiple CEXs | Place real orders / sign anything |
| Compute gross + approximate-net + executable-net spreads | Move funds between exchanges |
| Simulate execution at $50/$100/$250/$500/$1000 notionals against real depth | Manage real balances |
| Group point-in-time observations into lifecycles (open / close / max stats) | Predict BTC, "alpha" models, generic ML soup |
| Persist runs, books, candidates, estimates, lifecycles to SQLite | Pretty UI / dashboards |
| Generate per-symbol / per-route / lifecycle / aggregate reports | Polymarket *live* integration (architecture is in place; live adapters are stubs — see §Polymarket below) |
| Polymarket types, repos, repricing-lag detector, lifecycle tracker, feature builder, scan orchestrator | |

## Stack

- **TypeScript 5 + Node 20 (ESM)**, run with `tsx` for dev / `tsc` for typecheck.
- **better-sqlite3** for fast local persistence (`data/market_inefficiency_observatory.sqlite`).
- **CCXT** for CEX market data (REST, public endpoints — no keys needed).
- **zod** for env / config validation, **pino** for structured logs, **vitest** for tests.

## Install

```powershell
npm install
cp .env.example .env   # tweak thresholds if needed; defaults are sensible
```

## Run

```powershell
# CEX arbitrage scan (Ctrl+C to stop)
npm run scan:cex
npm run scan:cex -- --duration=10m   # bounded run

# Polymarket scan (skeleton — see Polymarket section below)
npm run scan:poly
npm run scan:poly -- --duration=10m

# Both observatories in parallel
npm run scan:all -- --duration=2h

# Reports (read-only over the SQLite DB)
npm run report:cex
npm run report:cex -- --run=<runId>
npm run report:poly
npm run report:summary

# Inspect a specific lifecycle/candidate by id
npm run inspect:event -- --id=42

# Phase 2.5 — local research dashboard (Next.js, read-only over SQLite)
npm run dashboard:dev        # http://localhost:3737
npm run dashboard:build && npm run dashboard:start

# Phase 2 — paper-execution simulator (read/replay over an existing run)
npm run paper:cex -- --run=<scannerRunId>
npm run paper:cex -- --run=<scannerRunId> --latencies=0,1000,3000,5000,10000
npm run paper:cex -- --run=<scannerRunId> \
  --symbols=PYTH/USDT --routes=bitget:mexc,kucoin:mexc,binance:mexc
```

## Tests / typecheck

```powershell
npm run typecheck
npm test
```

## Configuration

All knobs live in `.env` (see `.env.example` for every variable and its
default). Highlights:

| Variable | Meaning |
|---|---|
| `CEX_EXCHANGES` | comma list of CCXT ids. Defaults to `binance,gateio,kucoin,mexc,bitget,htx,coinex,bitfinex,coinbase`. Any CCXT spot id works; venues without an explicit `CEX_FEE_<ID>_TAKER` use the 0.2% conservative fallback. |
| `CEX_SYMBOL_MODE` | `fixed` (use `CEX_SYMBOLS`), `curated` (filter the project's curated USDT list by venue coverage), or `intersection` (discover dynamically from `loadMarkets()`). |
| `CEX_MIN_VENUES_PER_SYMBOL` | curated / intersection: drop symbols listed on fewer than this many enabled venues. |
| `CEX_MAX_SYMBOLS` | curated / intersection: hard cap on the resolved universe. |
| `CEX_SYMBOLS` | comma list of `BASE/QUOTE` pairs (used directly by `fixed`, used as the seed by `curated`). |
| `CEX_SCAN_INTERVAL_MS` | poll cadence per cycle |
| `CEX_TARGET_NOTIONALS` | comma list of USDT-equivalent notionals to depth-simulate |
| `CEX_MIN_*` | per-stage thresholds (gross / approx-net / executable-net / netProfit) |
| `CEX_FEE_<EX>_TAKER` | per-exchange taker fee override (decimal, conservative defaults) |
| `CEX_PERSIST_BOOK_SNAPSHOTS` | `none` / `opportunities_only` (default) / `all` |
| `CEX_SLOW_CYCLE_WARN_MS` | advisory warning budget for predicted/measured cycle work. |
| `CEX_EXPECTED_MS_PER_REQUEST` | per-REST-call ms used when predicting cycle cost at startup. |
| `POLYMARKET_ENABLED` | default `false` while adapters are stubs |
| `POLYMARKET_*_THRESHOLD_*` | thresholds the lag detector consumes |

### Exchange coverage

`CcxtExchangeAdapter` is venue-agnostic, so adding a new exchange means
adding its CCXT id to `CEX_EXCHANGES` (and optionally a `CEX_FEE_<ID>_TAKER`
override). The defaults already enable Binance, Gate.io, KuCoin, MEXC,
Bitget, HTX, CoinEx, Bitfinex, and Coinbase; OKX, Bybit, Kraken, BingX,
and Crypto.com have fee defaults pre-declared and can be opted in by name.

### "Material candidate" — the precise rule

`scanner_runs.total_material_candidates` counts candidates whose `isMaterial`
flag is set by `ArbitrageDetector.detect()`. A candidate is **material**
when *any* of its depth estimates satisfies ALL of:

1. `supportedByDepth` — both legs filled fully at the target notional.
2. `netProfitQuote >= CEX_MIN_NET_PROFIT_QUOTE`.
3. `netSpreadPct >= CEX_MIN_EXECUTABLE_NET_SPREAD_PCT`.

A candidate that passes the gross/approx-net pre-filters but fails one of
those three rules is still persisted (so the audit trail is honest) but is
not counted as material. The rule itself, plus the live thresholds, is
logged at scanner startup and surfaced in `report:cex` so the meaning of
`Total material candidates` is never ambiguous. The canonical definition
lives in `src/services/cex-arbitrage/material-rule.ts`.

Every CEX scan run records its config hash in `scanner_runs.config_hash` so
two reports can be compared knowing whether they used the same settings.

## How metrics are computed

- **Gross spread** — `(sellTopBid − buyTopAsk) / buyTopAsk × 100`.
- **Approximate net spread** — gross minus the sum of taker-fee rates of both
  legs. A *cheap pre-filter*; not the final word.
- **Executable net** — comes from `simulateDepthExecution`: walk the buy
  exchange's asks until the target USDT is filled, walk the sell exchange's
  bids until the acquired base is sold, subtract real fees on both legs.
- **`tradablePrefunded`** is set to true *only* when (a) both legs filled
  fully at the target, (b) net profit > 0, (c) books were not stale beyond
  `CEX_MAX_BOOK_STALENESS_MS`. It explicitly assumes the capital is already
  on both exchanges — Phase 1 never models bridging or withdrawals.
- **Lifecycles** — observations of the same `(symbol, buyExchange, sellExchange)`
  inside `CEX_OPPORTUNITY_CLOSE_GRACE_MS` extend an existing episode. Each
  closes when no sighting arrives within the grace period.

## Schema

`data/market_inefficiency_observatory.sqlite` is created on first run.
Migrations live in `src/persistence/migrations/`. Tables:

- `scanner_runs`
- `cex_order_book_snapshots` / `cex_arbitrage_candidates` / `cex_opportunity_estimates` / `cex_arbitrage_lifecycles`
- `polymarket_short_horizon_markets` / `crypto_reference_snapshots` / `polymarket_orderbook_snapshots` / `polymarket_feature_snapshots` / `repricing_lag_candidates` / `repricing_lag_lifecycles`

## Polymarket — what's built and what isn't

**Built (P3 skeleton):**
- domain types (`PolymarketShortHorizonMarket`, `CryptoReferenceSnapshot`,
  `PolymarketMarketSnapshot`, `PolymarketFeatureSnapshot`,
  `RepricingLagCandidate` and `RepricingLagEventType` union);
- repositories for markets / snapshots / reference feeds / events / lifecycles;
- `MarketResolverService`, `PolymarketClobCollector`,
  `CryptoReferenceFeedService` (Binance REST works; Chainlink is a stub),
  feature builder (`buildFeatureSnapshot`), `RepricingLifecycleTracker`,
  `PolymarketScanOrchestrator`, CLI commands;
- a *real* `detectRepricingLag` that emits three event classes
  (`reference_move_clob_lag`, `late_window_repricing_lag`,
  `binance_chainlink_divergence`) with thresholds — covered by unit tests.

**Stubbed (TODO before live data flows):**
- `PolymarketMarketDiscoveryAdapter` — wire to the Gamma API
  (`POLYMARKET_GAMMA_API_URL`) and lock the filter that identifies
  short-horizon BTC markets (slug pattern, tags, or dedicated endpoint).
- `PolymarketOrderBookAdapter` — issue REST `GET ${CLOB_API_URL}/book?token_id=…`
  for YES + NO and combine into a `PolymarketMarketSnapshot`.
- `PolymarketMarketWsAdapter` — subscribe to the CLOB `market` channel and
  emit snapshots (preferred for steady-state observation).
- `PolymarketRtdsAdapter` — Binance WS / Chainlink RPC streams.

`POLYMARKET_ENABLED` defaults to `false` so an out-of-the-box `npm run scan:all`
runs the CEX track and politely skips Polymarket. Flip it to `true` once the
adapters are populated.

## Limitations (be honest)

- CCXT REST has the lowest setup cost but is not as fast as native WebSockets.
  The `BaseExchangeAdapter` interface is intentionally minimal so individual
  venues can graduate to native WS adapters later without changing services.
- Depth simulation does not model: latency from observation to fill, fill
  partiality, queue position, transfer cost between exchanges. That is
  Phase 2's "Paper Simulation Engine" job.
- Fee model is taker-only and read from config. Maker discounts and VIP tiers
  are out of scope.
- `book.timestamps.sourceTimestampMs` is only populated when the venue ships
  one; otherwise downstream comparisons fall back to `receivedAtMs`. That gap
  matters most for the Polymarket lag track and is documented per detector.

## Phase 2 — CEX Prefunded Paper Execution Simulator

Phase 2 is a **read/replay simulator over the Observatory database**: it
re-walks every lifecycle a Phase 1 scanner run produced, asks "if we had
prefunded balances on both venues and reacted with latency *L*, would we have
actually paper-traded this opportunity?", and prints aggregate paper PnL,
inventory drift, and per-latency / per-route / per-symbol breakdowns.

It does **not** read real exchange prices, place any orders, or hold any
keys. It is a strict, deterministic projection of what stored Phase 1 signals
would have produced under a configurable policy.

### CLI

```powershell
npm run paper:cex -- --run=<scannerRunId>
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--run=<id>` | scanner run id to replay (required; see `npm run report:cex` to list runs) |
| `--policy=once_per_lifecycle\|cooldown_reentry` | trade-selection strategy (default once_per_lifecycle) |
| `--selection=best_profit\|largest_notional` | which estimate the selector prefers (default best_profit) |
| `--latencies=0,1000,3000,5000,10000` | comma list of reaction-latency scenarios (ms); each becomes one `paper_simulation_runs` row |
| `--min-profit=0.10` | per-estimate threshold on `net_profit_quote` |
| `--min-spread=0.03` | per-estimate threshold on `net_spread_pct` |
| `--max-notional=1000` | cap on the target notional per paper trade |
| `--portfolio=<path.json>` | explicit Mode-B prefunded balances (`{ "bitget": { "USDT": 5000 }, "mexc": { "PYTH": 100000 } }`) |
| `--symbols=PYTH/USDT,INJ/USDT` | restrict to a symbol set |
| `--routes=bitget:mexc,kucoin:mexc` | restrict to a buy:sell venue set |
| `--reentry-cooldown=60000` | cooldown (ms) between re-entries when `--policy=cooldown_reentry` |
| `--dry-report-only` | print the report but skip writing to SQLite |

All defaults can also be set via `PAPER_*` environment variables (see
`.env.example`). Empirically the recent CEX universe has shown a dominant
`PYTH/USDT` regime with `MEXC` as the expensive sell venue, so a useful first
invocation is:

```powershell
npm run paper:cex -- --run=<runId> --symbols=PYTH/USDT \
  --routes=bitget:mexc,kucoin:mexc,binance:mexc \
  --latencies=0,1000,3000,5000,10000
```

### How the simulator decides whether to trade

For each `(symbol, buyVenue, sellVenue)` lifecycle the loader pulls every
candidate/estimate from `cex_arbitrage_candidates` /
`cex_opportunity_estimates`. Then, for each latency scenario *L*:

1. **Latency replay.** Drop every estimate whose `detected_at` is below
   `lifecycle.first_seen_at + L`. If the lifecycle did not survive *L*, the
   simulator records a `lifecycle_too_short_for_latency` rejection.
2. **Threshold filter.** Keep only estimates whose `tradable_prefunded`,
   `supported_by_depth`, `net_profit_quote >= --min-profit`,
   `net_spread_pct >= --min-spread`, and `target_notional_quote <= --max-notional`.
3. **Selection.** `once_per_lifecycle` picks one best estimate per
   `--selection` (default highest `net_profit_quote`, tie-broken on spread →
   timestamp → id). `cooldown_reentry` walks every surviving estimate in time
   order, executing whenever inventory + cooldown allow.
4. **Inventory check.** The buy venue must hold
   `executable_buy_notional + taker_fee` of the quote currency; the sell
   venue must hold the base quantity that comes out of the buy leg. Failures
   are recorded under `insufficient_quote_inventory` or
   `insufficient_base_inventory`.
5. **Ledger update.** A successful trade decrements the buy venue's quote
   and credits its base, decrements the sell venue's base and credits its
   quote (net of taker fees on both sides). Aggregate PnL across the trade =
   stored `net_profit_quote`.

### Initial portfolio modes

| Mode | Trigger | Behaviour |
|---|---|---|
| **A — auto-prefund (default)** | no `--portfolio` flag | Every buy venue gets `PAPER_INITIAL_QUOTE_PER_BUY_VENUE` units of the symbol's quote currency. Every sell venue gets a base-asset balance worth `PAPER_INITIAL_BASE_NOTIONAL_PER_SELL_VENUE` at the *first observed* `avg_buy_price` for that symbol (a deterministic mid proxy). |
| **B — explicit JSON** | `--portfolio=path/to/file.json` | Caller supplies a `{venue: {asset: amount}}` map verbatim. Useful when you want to constrain only a couple of venues. |

### Persistence

Each `--latencies` value produces one row in `paper_simulation_runs` plus N
rows in `paper_arbitrage_trades`. Inspect with any SQL tool — both tables are
indexed by `source_scanner_run_id`.

### Output

The CLI prints an analytical report with:

- per-latency executed-trade count and PnL,
- aggregate top routes and top symbols by paper PnL,
- the rejection histogram (below threshold, latency expired, lifecycle too
  short, insufficient quote/base inventory),
- per-(venue, asset) inventory drift comparing initial vs final balances.

## Phase 2.5 — Integrated Research Dashboard

A local Next.js console reads the same SQLite database the scanner and paper
simulator write to. It is strictly read-only — see `dashboard/README.md` for
the full architecture and route map.

```powershell
# Terminal 1 — keep the scanner running
npm run scan:cex -- --duration=8h

# Terminal 2 — open the dashboard
npm run dashboard:dev          # http://localhost:3737
```

Four pages:

- **Overview** — vitals, dominant-regime callout, candidate flow chart,
  paper-simulator summary with latency-robustness indicator.
- **Observatory** — universe + material-rule cards, candidate funnel,
  top-symbol / top-route leaderboards, longest lifecycles.
- **Paper Simulator** — simulation family + latency scenario picker,
  PnL-by-latency chart, rejection histogram, per-venue inventory drift,
  trade log.
- **Runs** — comparison table of scanner runs and their paper simulations.

Auto-refreshes every 20 s via `router.refresh()`; click the pulsing dot to
pause.

## Roadmap (after Phase 2)

- **Phase 2.1** — multi-route inventory contention (multiple buy venues
  competing for the same sell-venue base inventory), per-venue inventory
  caps, route-specific allow/block lists, multi-run aggregation
  (`--all-runs`), and `--focus-top-opportunities` ranking heuristics.
- **Phase 2.6 (dashboard refinements)** — Lifecycle detail page with
  per-candidate spread timeline, run-vs-run diff view, route heatmap, and
  in-app trigger for new paper simulations.
- **Phase 3** — *Strategy Research*. Quality filters, opportunity score,
  simple interpretable probabilistic models, threshold calibration.
- **Phase 4** — *Execution Readiness*. Sandbox first, then circuit breakers,
  per-route limits, fail-safe, full audit trail. Only if the data warrants it.

## Anti-hype rules (kept verbatim from the brief)

- Do not assume viral posts represent replicable reality.
- Do not copy promotional numbers without validation.
- Do not confuse wallet PnL with reproducible strategy.
- Do not confuse *observable lag* with *executable edge*.
- Do not confuse *gross edge* with *net edge*.
- Do not confuse *probability mispricing* with *free money*.
- Do not use AI buzzwords as a substitute for empirical evidence.
