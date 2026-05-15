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
| `CEX_EXCHANGES` | comma list, e.g. `binance,gateio,kucoin,mexc` |
| `CEX_SYMBOLS` | comma list of `BASE/QUOTE` pairs |
| `CEX_SCAN_INTERVAL_MS` | poll cadence per cycle |
| `CEX_TARGET_NOTIONALS` | comma list of USDT-equivalent notionals to depth-simulate |
| `CEX_MIN_*` | per-stage thresholds (gross / approx-net / executable-net / netProfit) |
| `CEX_FEE_<EX>_TAKER` | per-exchange taker fee override (decimal, conservative defaults) |
| `CEX_PERSIST_BOOK_SNAPSHOTS` | `none` / `opportunities_only` (default) / `all` |
| `POLYMARKET_ENABLED` | default `false` while adapters are stubs |
| `POLYMARKET_*_THRESHOLD_*` | thresholds the lag detector consumes |

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

## Roadmap (after Phase 1)

- **Phase 2** — *Paper Simulation Engine*. Latency, partial fills, queue
  position, prefunded capital book-keeping, simulated PnL.
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
