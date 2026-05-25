# Arbitrage-Bot Dashboard (Phase 2.5)

Local, read-only quantitative research console for the Arbitrage-Bot
Observatory and Paper Simulator. Built with Next.js 14 (App Router) +
TypeScript + Tailwind CSS + Recharts, reading the same SQLite database the
scanner and paper simulator write to (`../data/market_inefficiency_observatory.sqlite`).

> **The dashboard never writes.** SQLite is opened with `readonly: true`.

## Quick start

From the **repository root**:

```powershell
# Terminal 1 — keep the scanner running
npm run scan:cex -- --duration=8h

# Terminal 2 — start the dashboard
npm run dashboard:dev
# → http://localhost:3737
```

Production build:

```powershell
npm run dashboard:build
npm run dashboard:start
```

Both commands proxy to `npm --prefix dashboard run <script>`, so they work
from the repo root without `cd`. You can also run them directly from this
folder:

```powershell
cd dashboard
npm install        # first time only
npm run dev
```

## Pages

| Route | Purpose |
|---|---|
| `/` | **Overview** — KPI cards, dominant-regime callout, candidate flow chart, paper simulator summary, top symbols/routes |
| `/observatory` | **Observatory** — universe + material-rule cards, candidate funnel, throughput, top-symbol / top-route leaderboards, longest lifecycles |
| `/simulator` | **Paper Simulator** — simulation family selector, latency-scenario picker, KPIs, PnL-by-latency chart, rejection histogram, route/symbol PnL tables, inventory drift, trade log |
| `/runs` | **Runs** — comparison table of scanner runs and their paper simulations |

The run selector at the top of each page deep-links via `?run=<scannerRunId>`
so URLs are shareable. The Simulator page also supports
`?sim=<familyId>&latency=<ms>`.

## Architecture

```
dashboard/
├── src/
│   ├── app/                       # Next.js App Router pages
│   │   ├── layout.tsx             # global shell + TopNav
│   │   ├── page.tsx               # Overview
│   │   ├── observatory/page.tsx
│   │   ├── simulator/page.tsx
│   │   └── runs/page.tsx
│   ├── components/
│   │   ├── nav/{TopNav, RunSelector}
│   │   ├── kpi/{MetricCard, StatusBadge, SectionHeader}
│   │   ├── common/{LiveRefreshIndicator, EmptyState}
│   │   ├── observatory/{UniverseMetadataCard, MaterialRuleCard,
│   │   │   FunnelMetrics, SymbolLeaderboard, RouteLeaderboard,
│   │   │   LifecycleTable}
│   │   ├── simulator/{SimulationFamilySelector, LatencyScenarioPicker,
│   │   │   PnLByLatencyChart, RejectionReasonsChart, InventoryDriftPanel,
│   │   │   RouteSymbolPnLTables, TradeLogTable}
│   │   ├── overview/{RegimeCallout, PaperSummaryPanel}
│   │   └── charts/{CandidatesOverTimeChart, LeaderboardBar}
│   └── lib/
│       ├── db.ts                  # SQLite read-only handle (cached)
│       ├── format.ts              # number / time / asset formatters
│       ├── regime.ts              # rule-based dominant-regime detector
│       └── queries/
│           ├── observatory.ts     # scanner / lifecycle / symbol / route queries
│           └── simulator.ts       # simulation / trade / portfolio queries
└── next.config.mjs
```

Every page is rendered with `dynamic = 'force-dynamic'` + `runtime = 'nodejs'`
so SQLite is consulted on every request — the dashboard is always reading
the latest state of the database.

## Auto-refresh

`<LiveRefreshIndicator />` polls `router.refresh()` every 20 seconds. Server
components re-execute their SQLite queries, the React tree streams in, and
nothing flickers. Click the pulsing dot to pause; click the timestamp to
refresh on demand.

## Custom database path

By default the dashboard expects the SQLite file at
`../data/market_inefficiency_observatory.sqlite` (one level up from this
folder). Override with:

```powershell
$env:DASHBOARD_DB_PATH = 'C:\path\to\custom.sqlite'
npm run dev
```

## What it does NOT do

- Place orders, write to SQLite, hold API keys.
- Trigger new simulations from the UI (use the CLI — `npm run paper:cex --
  --run=<id>`).
- Replace any existing report CLI; everything is additive.

## Verifying it against the most recent PYTH/MEXC run

1. `npm run scan:cex` (or use an existing run).
2. `npm run paper:cex -- --run=<runId> --latencies=0,1000,3000,5000,10000`
3. `npm run dashboard:dev` and open <http://localhost:3737>.

You should see:

- Overview: `PYTH/USDT` as the dominant regime, MEXC as the sell sink.
- Observatory: PYTH/USDT topping both leaderboards; long multi-observation
  lifecycles.
- Simulator: 5 latency scenarios, a PnL-by-latency bar chart, an inventory
  drift panel showing PYTH flowing away from MEXC and USDT flowing toward
  it.

## Tech notes

- `better-sqlite3` is declared in `experimental.serverComponentsExternalPackages`
  so Next.js does not try to bundle the native binding into the React-server
  bundle.
- Recharts is used for all charts; tooltip + grid styling is overridden in
  `globals.css` for the dark theme.
- All numeric formatting goes through `lib/format.ts` so locale-aware
  grouping is consistent across components.

## License

Same as the parent project.
