import { portfolioDrift } from './portfolio-ledger.js';

import type {
  PaperArbitrageTrade,
  PaperSimulationResult,
  RejectionReason,
} from './paper-trade-types.js';

export interface RouteAggregate {
  buyVenue: string;
  sellVenue: string;
  trades: number;
  totalNetProfitQuote: number;
}

export interface SymbolAggregate {
  symbol: string;
  trades: number;
  totalNetProfitQuote: number;
}

export interface BestTradeRow {
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  netProfitQuote: number;
}

export interface ScenarioReport {
  latencyMs: number;
  policyName: string;
  eligibleLifecycles: number;
  executedTrades: number;
  rejections: Record<RejectionReason, number>;
  totalNetProfitQuote: number;
  avgNetProfitQuote: number;
  medianNetProfitQuote: number;
  topByRoute: RouteAggregate[];
  topBySymbol: SymbolAggregate[];
  bestTrade: BestTradeRow | null;
  initialPortfolio: PaperSimulationResult['initialPortfolio'];
  finalPortfolio: PaperSimulationResult['finalPortfolio'];
  drift: PaperSimulationResult['finalPortfolio'];
}

export class PaperExecutionReportService {
  build(result: PaperSimulationResult): ScenarioReport {
    const trades = result.trades;
    const totalNetProfit = trades.reduce((acc, t) => acc + t.netProfitQuote, 0);
    const avg = trades.length > 0 ? totalNetProfit / trades.length : 0;
    const median = computeMedian(trades.map((t) => t.netProfitQuote));

    return {
      latencyMs: result.latencyMs,
      policyName: result.policy.policyName,
      eligibleLifecycles: result.eligibleLifecycles,
      executedTrades: trades.length,
      rejections: result.rejectionsByReason,
      totalNetProfitQuote: totalNetProfit,
      avgNetProfitQuote: avg,
      medianNetProfitQuote: median,
      topByRoute: aggregateByRoute(trades),
      topBySymbol: aggregateBySymbol(trades),
      bestTrade: pickBestTrade(trades),
      initialPortfolio: result.initialPortfolio,
      finalPortfolio: result.finalPortfolio,
      drift: portfolioDrift(result.initialPortfolio, result.finalPortfolio),
    };
  }

  format(scenarios: ScenarioReport[], header: ReportHeader): string {
    const lines: string[] = [];
    lines.push('CEX PREFUNDED PAPER EXECUTION — REPORT');
    lines.push('--------------------------------------');
    lines.push(`Source scanner run:                  ${header.sourceScannerRunId}`);
    lines.push(`Policy:                              ${header.policyName}`);
    lines.push(`Selection mode:                      ${header.selectionMode}`);
    lines.push(`Latencies tested:                    ${header.latenciesMs.map(fmtMs).join(', ')}`);
    lines.push(`Min profit:                          ${fmt(header.minProfitQuote)} USDT`);
    lines.push(`Min spread:                          ${fmt(header.minSpreadPct, 4)}%`);
    lines.push(`Max notional:                        ${fmt(header.maxNotionalQuote, 0)} USDT`);
    if (header.reentryCooldownMs !== undefined) {
      lines.push(`Reentry cooldown:                    ${header.reentryCooldownMs}ms`);
    }
    if (header.symbolsFilter && header.symbolsFilter.length > 0) {
      lines.push(`Symbols filter:                      ${header.symbolsFilter.join(', ')}`);
    }
    if (header.routesFilter && header.routesFilter.length > 0) {
      lines.push(
        `Routes filter:                       ${header.routesFilter
          .map(([buy, sell]) => `${buy}->${sell}`)
          .join(', ')}`,
      );
    }
    lines.push('');

    if (scenarios.length === 0) {
      lines.push('No scenarios were produced. Nothing to report.');
      return lines.join('\n');
    }

    const first = scenarios[0]!;
    lines.push(`Eligible lifecycles:                 ${first.eligibleLifecycles}`);

    for (const s of scenarios) {
      lines.push(`Executed trades @ ${fmtMs(s.latencyMs).padEnd(8)}        ${s.executedTrades}`);
    }
    lines.push('');
    lines.push('PnL by latency:');
    for (const s of scenarios) {
      lines.push(
        `  ${fmtMs(s.latencyMs).padEnd(8)}  ${fmtSigned(s.totalNetProfitQuote).padStart(10)} USDT` +
          `  trades=${String(s.executedTrades).padStart(4)}` +
          `  avg=${fmtSigned(s.avgNetProfitQuote).padStart(9)}` +
          `  median=${fmtSigned(s.medianNetProfitQuote).padStart(9)}`,
      );
    }

    for (const s of scenarios) {
      lines.push('');
      lines.push(`Scenario detail @ latency=${fmtMs(s.latencyMs)}`);
      lines.push('  Rejections by reason:');
      lines.push(`    below threshold:                ${s.rejections.below_threshold}`);
      lines.push(`    latency expired:                ${s.rejections.latency_expired}`);
      lines.push(`    lifecycle too short:            ${s.rejections.lifecycle_too_short_for_latency}`);
      lines.push(`    insufficient quote inventory:   ${s.rejections.insufficient_quote_inventory}`);
      lines.push(`    insufficient base inventory:    ${s.rejections.insufficient_base_inventory}`);

      lines.push('  Top routes by paper PnL:');
      if (s.topByRoute.length === 0) {
        lines.push('    (none)');
      } else {
        for (const r of s.topByRoute.slice(0, 5)) {
          lines.push(
            `    ${r.buyVenue.padEnd(10)} -> ${r.sellVenue.padEnd(10)} ` +
              `${fmtSigned(r.totalNetProfitQuote).padStart(9)} USDT  trades=${r.trades}`,
          );
        }
      }
      lines.push('  Top symbols by paper PnL:');
      if (s.topBySymbol.length === 0) {
        lines.push('    (none)');
      } else {
        for (const r of s.topBySymbol.slice(0, 5)) {
          lines.push(
            `    ${r.symbol.padEnd(12)} ${fmtSigned(r.totalNetProfitQuote).padStart(9)} USDT` +
              `  trades=${r.trades}`,
          );
        }
      }
      if (s.bestTrade) {
        lines.push(
          `  Best trade: ${s.bestTrade.symbol} ${s.bestTrade.buyVenue}->${s.bestTrade.sellVenue} ` +
            `${fmtSigned(s.bestTrade.netProfitQuote)} USDT`,
        );
      }
      lines.push('  Inventory drift:');
      const driftLines = formatDrift(s.drift);
      if (driftLines.length === 0) lines.push('    (none)');
      for (const dl of driftLines) lines.push(`    ${dl}`);
    }
    return lines.join('\n');
  }
}

export interface ReportHeader {
  sourceScannerRunId: string;
  policyName: string;
  selectionMode: string;
  latenciesMs: number[];
  minProfitQuote: number;
  minSpreadPct: number;
  maxNotionalQuote: number;
  reentryCooldownMs?: number;
  symbolsFilter?: string[];
  routesFilter?: Array<[string, string]>;
}

function aggregateByRoute(trades: PaperArbitrageTrade[]): RouteAggregate[] {
  const map = new Map<string, RouteAggregate>();
  for (const t of trades) {
    const key = `${t.buyVenue}|${t.sellVenue}`;
    const cur = map.get(key) ?? {
      buyVenue: t.buyVenue,
      sellVenue: t.sellVenue,
      trades: 0,
      totalNetProfitQuote: 0,
    };
    cur.trades += 1;
    cur.totalNetProfitQuote += t.netProfitQuote;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.totalNetProfitQuote - a.totalNetProfitQuote);
}

function aggregateBySymbol(trades: PaperArbitrageTrade[]): SymbolAggregate[] {
  const map = new Map<string, SymbolAggregate>();
  for (const t of trades) {
    const cur = map.get(t.symbol) ?? {
      symbol: t.symbol,
      trades: 0,
      totalNetProfitQuote: 0,
    };
    cur.trades += 1;
    cur.totalNetProfitQuote += t.netProfitQuote;
    map.set(t.symbol, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.totalNetProfitQuote - a.totalNetProfitQuote);
}

function pickBestTrade(trades: PaperArbitrageTrade[]): BestTradeRow | null {
  if (trades.length === 0) return null;
  let best = trades[0]!;
  for (const t of trades) if (t.netProfitQuote > best.netProfitQuote) best = t;
  return {
    symbol: best.symbol,
    buyVenue: best.buyVenue,
    sellVenue: best.sellVenue,
    netProfitQuote: best.netProfitQuote,
  };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function formatDrift(drift: PaperSimulationResult['finalPortfolio']): string[] {
  const out: string[] = [];
  for (const venue of Object.keys(drift).sort()) {
    const assets = drift[venue] ?? {};
    for (const asset of Object.keys(assets).sort()) {
      const value = assets[asset] ?? 0;
      if (Math.abs(value) < 1e-9) continue;
      out.push(`${venue}.${asset.padEnd(6)} ${fmtSigned(value, 4)}`);
    }
  }
  return out;
}

function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

function fmtSigned(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}` : s;
}

function fmtMs(ms: number): string {
  return `${ms}ms`;
}
