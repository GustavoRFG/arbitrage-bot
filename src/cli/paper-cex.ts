#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getAppConfig } from '../config/app-config.js';
import { getLogger } from '../core/logger/logger.js';
import { newRunId } from '../core/run-context/scanner-run.js';
import { nowMs } from '../core/types/timestamps.js';
import { getDb } from '../persistence/db.js';
import { PaperSimulationRepository } from '../persistence/repositories/paper-simulation-repository.js';
import { FeeResolver } from '../services/cex-arbitrage/fee-resolver.js';
import {
  CandidateReplayLoader,
  type CandidateReplayFilter,
} from '../services/cex-paper-execution/candidate-replay-loader.js';
import {
  PaperExecutionReportService,
  type ReportHeader,
  type ScenarioReport,
} from '../services/cex-paper-execution/paper-execution-report-service.js';
import {
  buildPolicy,
  parseSelectionMode,
  parseStrategy,
} from '../services/cex-paper-execution/paper-simulation-policy.js';
import {
  buildAutoPrefundedPortfolio,
  PaperSimulator,
} from '../services/cex-paper-execution/paper-simulator.js';
import type {
  PaperPortfolioJson,
  PaperSimulationResult,
} from '../services/cex-paper-execution/paper-trade-types.js';

const log = getLogger('cli.paper-cex');

interface CliArgs {
  runId?: string;
  policy?: string;
  selectionMode?: string;
  latenciesMs?: number[];
  minProfit?: number;
  minSpread?: number;
  maxNotional?: number;
  portfolioPath?: string;
  symbols?: string[];
  routes?: Array<[string, string]>;
  reentryCooldownMs?: number;
  dryReportOnly: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryReportOnly: false, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      out.help = true;
    } else if (raw === '--dry-report-only') {
      out.dryReportOnly = true;
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
    } else if (raw.startsWith('--portfolio=')) {
      out.portfolioPath = raw.slice('--portfolio='.length).trim();
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
    }
  }
  return out;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'paper:cex — Phase 2 prefunded paper-execution simulator',
      '',
      'Usage:',
      '  npm run paper:cex -- --run=<scannerRunId> [options]',
      '',
      'Options:',
      '  --run=<id>                  scanner run to replay (REQUIRED)',
      '  --policy=<name>             once_per_lifecycle (default) | cooldown_reentry',
      '  --selection=<mode>          best_profit (default) | largest_notional',
      '  --latencies=0,1000,3000     comma list of latencies in ms',
      '  --min-profit=0.10           min net profit (quote) per estimate',
      '  --min-spread=0.03           min net spread % per estimate',
      '  --max-notional=1000         cap on target notional per trade',
      '  --portfolio=<path.json>     explicit prefunded balances (Mode B)',
      '  --symbols=PYTH/USDT,...     filter lifecycles by symbol',
      '  --routes=bitget:mexc,...    filter lifecycles by buy:sell venue',
      '  --reentry-cooldown=60000    cooldown (ms) for cooldown_reentry',
      '  --dry-report-only           skip DB persistence (still prints report)',
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
  const policyArg = args.policy ?? cfg.PAPER_POLICY;
  const selectionArg = args.selectionMode ?? cfg.PAPER_SELECTION_MODE;
  const strategy = parseStrategy(policyArg);
  const selectionMode = parseSelectionMode(selectionArg);
  const minProfit = args.minProfit ?? cfg.PAPER_MIN_NET_PROFIT_QUOTE;
  const minSpread = args.minSpread ?? cfg.PAPER_MIN_NET_SPREAD_PCT;
  const maxNotional = args.maxNotional ?? cfg.PAPER_MAX_TARGET_NOTIONAL_QUOTE;
  const reentryCooldownMs = args.reentryCooldownMs ?? cfg.PAPER_REENTRY_COOLDOWN_MS;
  const latencies =
    args.latenciesMs && args.latenciesMs.length > 0
      ? args.latenciesMs
      : cfg.PAPER_EXECUTION_LATENCY_MS;

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
      policyName: policy.policyName,
    },
    'paper simulator: loaded lifecycles',
  );
  if (lifecycles.length === 0) {
    log.warn('no lifecycles matched the filter — report will be empty');
  }

  const initialPortfolio = args.portfolioPath
    ? loadPortfolioJson(args.portfolioPath)
    : buildAutoPrefundedPortfolio({
        lifecycles,
        quotePerBuyVenue: cfg.PAPER_INITIAL_QUOTE_PER_BUY_VENUE,
        baseNotionalPerSellVenue: cfg.PAPER_INITIAL_BASE_NOTIONAL_PER_SELL_VENUE,
      });

  const feeResolver = new FeeResolver();
  const repo = new PaperSimulationRepository(db);
  const reportService = new PaperExecutionReportService();
  const scenarios: ScenarioReport[] = [];

  for (const latencyMs of latencies) {
    const simulationRunId = `${newRunId('cex')}_paper_l${latencyMs}`;
    const simulator = new PaperSimulator({
      simulationRunId,
      sourceScannerRunId: args.runId,
      policy,
      latencyMs,
      lifecycles,
      initialPortfolio,
      feeResolver,
      createdAtMs: nowMs(),
      ...(args.symbols && args.symbols.length > 0 ? { symbolsFilter: args.symbols } : {}),
      ...(args.routes && args.routes.length > 0 ? { routesFilter: args.routes } : {}),
    });
    const result: PaperSimulationResult = simulator.run();

    if (!args.dryReportOnly) {
      repo.record(result);
    }
    scenarios.push(reportService.build(result));
    log.info(
      {
        latencyMs,
        trades: result.trades.length,
        rejected: result.rejections.length,
        totalNetProfit: result.totalNetProfitQuote,
        simulationRunId,
      },
      'paper simulator: scenario complete',
    );
  }

  const header: ReportHeader = {
    sourceScannerRunId: args.runId,
    policyName: policy.policyName,
    selectionMode: policy.selectionMode,
    latenciesMs: latencies,
    minProfitQuote: minProfit,
    minSpreadPct: minSpread,
    maxNotionalQuote: maxNotional,
  };
  if (policy.strategy === 'cooldown_reentry') header.reentryCooldownMs = reentryCooldownMs;
  if (args.symbols && args.symbols.length > 0) header.symbolsFilter = args.symbols;
  if (args.routes && args.routes.length > 0) header.routesFilter = args.routes;

  // eslint-disable-next-line no-console
  console.log(reportService.format(scenarios, header));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
