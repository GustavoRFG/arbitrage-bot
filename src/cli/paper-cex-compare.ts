#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getAppConfig } from '../config/app-config.js';
import { getLogger } from '../core/logger/logger.js';
import { newRunId } from '../core/run-context/scanner-run.js';
import { nowMs } from '../core/types/timestamps.js';
import { getDb } from '../persistence/db.js';
import {
  PaperComparisonRepository,
  newComparisonRunId,
} from '../persistence/repositories/paper-comparison-repository.js';
import { FeeResolver } from '../services/cex-arbitrage/fee-resolver.js';
import {
  CandidateReplayLoader,
  type CandidateReplayFilter,
} from '../services/cex-paper-execution/candidate-replay-loader.js';
import { ComparisonReportService } from '../services/cex-paper-execution/comparison-report-service.js';
import {
  PRESETS,
  parsePresetName,
  type InventoryPresetName,
  type PresetSpec,
} from '../services/cex-paper-execution/inventory-presets.js';
import {
  buildPolicy,
  parseSelectionMode,
  parseStrategy,
} from '../services/cex-paper-execution/paper-simulation-policy.js';
import {
  runComparison,
  type ContentionMode,
} from '../services/cex-paper-execution/simulation-comparison.js';
import type { PaperPortfolioJson } from '../services/cex-paper-execution/paper-trade-types.js';

const log = getLogger('cli.paper-cex-compare');

interface CliArgs {
  runId?: string;
  policy?: string;
  selectionMode?: string;
  latenciesMs?: number[];
  minProfit?: number;
  minSpread?: number;
  maxNotional?: number;
  presetNames?: InventoryPresetName[];
  customPortfolioPath?: string;
  customLabel?: string;
  symbols?: string[];
  routes?: Array<[string, string]>;
  reentryCooldownMs?: number;
  contentionMode?: ContentionMode;
  persist?: boolean;
  label?: string;
  dashboardBaseUrl?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      out.help = true;
    } else if (raw.startsWith('--run=')) {
      out.runId = raw.slice('--run='.length).trim();
    } else if (raw.startsWith('--policy=')) {
      out.policy = raw.slice('--policy='.length).trim();
    } else if (raw.startsWith('--selection=')) {
      out.selectionMode = raw.slice('--selection='.length).trim();
    } else if (raw.startsWith('--latencies=')) {
      out.latenciesMs = raw
        .slice('--latencies='.length)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
    } else if (raw.startsWith('--min-profit=')) {
      out.minProfit = Number(raw.slice('--min-profit='.length));
    } else if (raw.startsWith('--min-spread=')) {
      out.minSpread = Number(raw.slice('--min-spread='.length));
    } else if (raw.startsWith('--max-notional=')) {
      out.maxNotional = Number(raw.slice('--max-notional='.length));
    } else if (raw.startsWith('--presets=')) {
      out.presetNames = raw
        .slice('--presets='.length)
        .split(',')
        .map((s) => parsePresetName(s.trim()))
        .filter(Boolean);
    } else if (raw.startsWith('--custom-portfolio=')) {
      out.customPortfolioPath = raw.slice('--custom-portfolio='.length).trim();
    } else if (raw.startsWith('--custom-label=')) {
      out.customLabel = raw.slice('--custom-label='.length).trim();
    } else if (raw.startsWith('--symbols=')) {
      out.symbols = raw
        .slice('--symbols='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (raw.startsWith('--routes=')) {
      const parts = raw
        .slice('--routes='.length)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const routes: Array<[string, string]> = [];
      for (const p of parts) {
        const [buy, sell] = p.split(':');
        if (!buy || !sell) throw new Error(`Invalid --routes entry: ${p} (expected buy:sell)`);
        routes.push([buy.trim(), sell.trim()]);
      }
      out.routes = routes;
    } else if (raw.startsWith('--reentry-cooldown=')) {
      out.reentryCooldownMs = Number(raw.slice('--reentry-cooldown='.length));
    } else if (raw.startsWith('--contention=')) {
      const mode = raw.slice('--contention='.length).trim();
      if (mode !== 'single_route' && mode !== 'multi_route') {
        throw new Error(`Unknown --contention ${mode} (supported: single_route, multi_route)`);
      }
      out.contentionMode = mode;
    } else if (raw === '--persist') {
      out.persist = true;
    } else if (raw === '--no-persist' || raw === '--dry-report-only') {
      out.persist = false;
    } else if (raw.startsWith('--label=')) {
      out.label = raw.slice('--label='.length).trim();
    } else if (raw.startsWith('--dashboard-url=')) {
      out.dashboardBaseUrl = raw.slice('--dashboard-url='.length).trim();
    }
  }
  return out;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'paper:cex:compare — Phase 2.1 inventory preset × latency comparison',
      '',
      'Usage:',
      '  npm run paper:cex:compare -- --run=<scannerRunId> [options]',
      '',
      'Options:',
      '  --run=<id>                  scanner run to replay (REQUIRED)',
      '  --policy=<name>             once_per_lifecycle (default) | cooldown_reentry',
      '  --selection=<mode>          best_profit (default) | largest_notional | fifo |',
      '                              best_profit_first | best_spread_first | inventory_efficiency',
      '  --latencies=0,1000,3000     comma list of latencies in ms',
      '  --presets=conservative,moderate,aggressive   subset to compare',
      '  --custom-portfolio=<path>   add a custom JSON portfolio as one extra preset',
      '  --custom-label="my preset"  label for the custom preset (defaults to "custom")',
      '  --contention=multi_route    multi_route | single_route (default: single_route)',
      '  --min-profit=0.10           min net profit (quote) per estimate',
      '  --min-spread=0.03           min net spread % per estimate',
      '  --max-notional=1000         cap on target notional per trade',
      '  --symbols=PYTH/USDT,...     filter lifecycles by symbol',
      '  --routes=bitget:mexc,...    filter lifecycles by buy:sell venue',
      '  --reentry-cooldown=60000    cooldown (ms) for cooldown_reentry',
      '  --persist                   persist comparison to SQLite for dashboard (default)',
      '  --no-persist                print report only, no DB write',
      '  --dry-report-only           alias for --no-persist',
      '  --label="..."               human-readable label stored alongside the comparison',
      '  --dashboard-url=http://...  base URL printed in the persistence success message',
      '  --help                      print this help',
    ].join('\n'),
  );
}

function loadPortfolioJson(path: string): PaperPortfolioJson {
  const absolute = resolve(path);
  const raw = readFileSync(absolute, 'utf-8');
  const parsed = JSON.parse(raw) as PaperPortfolioJson;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Portfolio JSON at ${absolute} must be an object of {venue: {asset: amount}}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.runId) {
    printHelp();
    throw new Error('--run=<scannerRunId> is required (see `npm run report:cex` for run ids)');
  }

  const cfg = getAppConfig();
  const strategy = parseStrategy(args.policy ?? cfg.PAPER_POLICY);
  const selectionMode = parseSelectionMode(args.selectionMode ?? cfg.PAPER_SELECTION_MODE);
  const minProfit = args.minProfit ?? cfg.PAPER_MIN_NET_PROFIT_QUOTE;
  const minSpread = args.minSpread ?? cfg.PAPER_MIN_NET_SPREAD_PCT;
  const maxNotional = args.maxNotional ?? cfg.PAPER_MAX_TARGET_NOTIONAL_QUOTE;
  const reentryCooldownMs = args.reentryCooldownMs ?? cfg.PAPER_REENTRY_COOLDOWN_MS;
  const latencies =
    args.latenciesMs && args.latenciesMs.length > 0
      ? args.latenciesMs
      : cfg.PAPER_EXECUTION_LATENCY_MS;
  const contentionMode: ContentionMode = args.contentionMode ?? 'single_route';

  if (latencies.length === 0) throw new Error('No latencies configured (set --latencies or PAPER_EXECUTION_LATENCY_MS)');

  const policy = buildPolicy({
    strategy,
    selectionMode,
    minNetProfitQuote: minProfit,
    minNetSpreadPct: minSpread,
    maxTargetNotionalQuote: maxNotional,
    ...(strategy === 'cooldown_reentry' ? { reentryCooldownMs } : {}),
  });

  const db = getDb();
  const loader = new CandidateReplayLoader(db);
  if (!loader.scannerRunExists(args.runId)) {
    throw new Error(`Scanner run not found in DB: ${args.runId}`);
  }
  const filter: CandidateReplayFilter = {};
  if (args.symbols && args.symbols.length > 0) filter.symbols = args.symbols;
  if (args.routes && args.routes.length > 0) filter.routes = args.routes;
  const lifecycles = loader.load(args.runId, filter);
  log.info(
    {
      runId: args.runId,
      lifecycles: lifecycles.length,
      filter,
      latencies,
      contentionMode,
      policyName: policy.policyName,
    },
    'paper-compare: loaded lifecycles',
  );

  // Build preset specs.
  const presetNames = args.presetNames && args.presetNames.length > 0
    ? args.presetNames
    : (['conservative', 'moderate', 'aggressive'] as InventoryPresetName[]);
  const presets: PresetSpec[] = [];
  for (const name of presetNames) {
    if (name === 'custom') continue; // handled below
    presets.push(PRESETS[name]);
  }
  if (args.customPortfolioPath) {
    presets.push({
      name: 'custom',
      label: args.customLabel ?? `custom (${args.customPortfolioPath})`,
      portfolio: loadPortfolioJson(args.customPortfolioPath),
    });
  }
  if (presets.length === 0) {
    throw new Error('No presets selected. Use --presets=... or --custom-portfolio=...');
  }

  const feeResolver = new FeeResolver();
  const report = runComparison({
    sourceScannerRunId: args.runId,
    policy,
    latenciesMs: latencies,
    presets,
    lifecycles,
    feeResolver,
    createdAtMs: nowMs(),
    contentionMode,
    simulationRunIdPrefix: `${newRunId('cex')}_paper_cmp`,
    ...(args.symbols && args.symbols.length > 0 ? { symbolsFilter: args.symbols } : {}),
    ...(args.routes && args.routes.length > 0 ? { routesFilter: args.routes } : {}),
  });

  // eslint-disable-next-line no-console
  console.log(new ComparisonReportService().format(report));

  const shouldPersist = args.persist !== false; // default true
  if (shouldPersist) {
    const comparisonRunId = newComparisonRunId('cex_paper_cmp', nowMs());
    const repo = new PaperComparisonRepository(db);
    const persistResult = repo.persist({
      comparisonRunId,
      createdAtMs: nowMs(),
      report,
      ...(args.label ? { label: args.label } : {}),
      ...(args.symbols && args.symbols.length > 0 ? { symbolsFilter: args.symbols } : {}),
      ...(args.routes && args.routes.length > 0 ? { routesFilter: args.routes } : {}),
      eligibleLifecycles: lifecycles.length,
    });
    const dashboardBaseUrl = args.dashboardBaseUrl ?? 'http://localhost:3737';
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        `Comparison run persisted: ${persistResult.comparisonRunId}`,
        `  scenarios:                ${persistResult.scenarioCount}`,
        `  best preset / latency:    ${persistResult.bestPresetName ?? '-'} / ${persistResult.bestLatencyMs ?? '-'}ms`,
        `  best total PnL (quote):   ${persistResult.bestTotalNetProfitQuote?.toFixed(4) ?? '-'}`,
        `  total missed PnL (quote): ${persistResult.totalMissedProfitQuote.toFixed(4)}`,
        `  top bottleneck:           ${persistResult.topBottleneckReason ?? '-'}`,
        '',
        `Open dashboard: ${dashboardBaseUrl}/compare?run=${args.runId}&comparison=${persistResult.comparisonRunId}`,
      ].join('\n'),
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('\n(--no-persist / --dry-report-only set — comparison was NOT written to SQLite)');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
