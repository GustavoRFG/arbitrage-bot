/**
 * Phase 2.1 — comparison report renderer.
 *
 * Turns a `ComparisonReport` (a grid of {preset, latency} cells) into a
 * compact analytical text report:
 *   - one PnL/trade-count table comparing presets at each latency;
 *   - per-cell detail with rejections, missed PnL, top reports, and
 *     final inventory drift.
 *
 * The report is intentionally textual (not JSON) — it is meant to be read
 * directly in a terminal during a research session.
 */

import type {
  ComparisonCell,
  ComparisonReport,
} from './simulation-comparison.js';
import type { PaperPortfolioJson, RejectionReason } from './paper-trade-types.js';

export class ComparisonReportService {
  format(report: ComparisonReport): string {
    const lines: string[] = [];
    lines.push('CEX PREFUNDED PAPER EXECUTION — INVENTORY/LATENCY COMPARISON');
    lines.push('------------------------------------------------------------');
    lines.push(`Source scanner run:    ${report.sourceScannerRunId}`);
    lines.push(`Policy:                ${report.policy.policyName}`);
    lines.push(`Selection mode:        ${report.policy.selectionMode}`);
    lines.push(`Contention mode:       ${report.contentionMode}`);
    lines.push(`Latencies tested:      ${report.latenciesMs.map((m) => `${m}ms`).join(', ')}`);
    lines.push(`Min profit / spread:   ${fmt(report.policy.minNetProfitQuote)} USDT / ${fmt(report.policy.minNetSpreadPct, 4)}%`);
    lines.push(`Max notional / trade:  ${fmt(report.policy.maxTargetNotionalQuote, 0)} USDT`);
    lines.push('');

    // Side-by-side PnL / trade-count grid.
    const presets = [...new Set(report.cells.map((c) => c.presetName))];
    const latencies = report.latenciesMs;

    lines.push('PnL by preset × latency (net USDT, [trades]):');
    lines.push(`  ${'latency'.padEnd(12)}  ${presets.map((p) => p.padEnd(18)).join(' ')}`);
    for (const lat of latencies) {
      const row = [`  ${(`${lat}ms`).padEnd(12)}`];
      for (const preset of presets) {
        const cell = report.cells.find((c) => c.presetName === preset && c.latencyMs === lat);
        if (!cell) {
          row.push('—'.padEnd(18));
        } else {
          const pnl = fmtSigned(cell.totalNetProfitQuote).padStart(9);
          const ntrades = `[${cell.executedTrades}]`.padStart(6);
          row.push(`${pnl} ${ntrades}      `);
        }
      }
      lines.push(row.join(' '));
    }
    lines.push('');

    // Rejection mix per cell.
    lines.push('Rejections by reason (preset × latency):');
    lines.push(
      `  ${'cell'.padEnd(28)}  ${'below'.padStart(6)} ${'lat-x'.padStart(6)} ${'short'.padStart(6)} ${'no-q'.padStart(6)} ${'no-b'.padStart(6)}`,
    );
    for (const cell of report.cells) {
      const tag = `${cell.presetName}@${cell.latencyMs}ms`.padEnd(28);
      const r = cell.rejectionsByReason;
      lines.push(
        `  ${tag}  ${String(r.below_threshold).padStart(6)} ${String(r.latency_expired).padStart(6)} ` +
          `${String(r.lifecycle_too_short_for_latency).padStart(6)} ${String(r.insufficient_quote_inventory).padStart(6)} ` +
          `${String(r.insufficient_base_inventory).padStart(6)}`,
      );
    }
    lines.push('');

    // Missed-PnL summary per cell.
    lines.push('Missed PnL by reason (preset × latency):');
    lines.push(
      `  ${'cell'.padEnd(28)}  ${'below'.padStart(8)} ${'lat-x'.padStart(8)} ${'short'.padStart(8)} ${'no-q'.padStart(8)} ${'no-b'.padStart(8)}  total`,
    );
    for (const cell of report.cells) {
      const tag = `${cell.presetName}@${cell.latencyMs}ms`.padEnd(28);
      const m = cell.missed.missedProfitByReason;
      lines.push(
        `  ${tag}  ${fmtSigned(m.below_threshold).padStart(8)} ${fmtSigned(m.latency_expired).padStart(8)} ` +
          `${fmtSigned(m.lifecycle_too_short_for_latency).padStart(8)} ${fmtSigned(m.insufficient_quote_inventory).padStart(8)} ` +
          `${fmtSigned(m.insufficient_base_inventory).padStart(8)}  ${fmtSigned(cell.missed.totalMissedProfitQuote).padStart(8)}`,
      );
    }
    lines.push('');

    // Per-cell detail block.
    for (const cell of report.cells) {
      lines.push(`Detail: preset=${cell.presetName} latency=${cell.latencyMs}ms (${cell.simulationRunId})`);
      lines.push(`  Preset:                  ${cell.presetLabel}`);
      lines.push(`  Total net profit:        ${fmtSigned(cell.totalNetProfitQuote)} USDT`);
      lines.push(`  Executed trades:         ${cell.executedTrades}`);
      lines.push(`  Total missed PnL:        ${fmtSigned(cell.missed.totalMissedProfitQuote)} USDT`);

      lines.push('  Top executed trades:');
      if (cell.topExecuted.length === 0) {
        lines.push('    (none)');
      } else {
        for (const t of cell.topExecuted.slice(0, 5)) {
          lines.push(
            `    ${t.symbol.padEnd(12)} ${t.buyVenue.padEnd(10)}->${t.sellVenue.padEnd(10)} ` +
              `${fmtSigned(t.netProfitQuote).padStart(9)} USDT  spread=${fmt(t.netSpreadPct, 4)}%`,
          );
        }
      }

      lines.push('  Top missed trades:');
      if (cell.topMissed.length === 0) {
        lines.push('    (none)');
      } else {
        for (const m of cell.topMissed.slice(0, 5)) {
          lines.push(
            `    ${m.symbol.padEnd(12)} ${m.buyVenue.padEnd(10)}->${m.sellVenue.padEnd(10)} ` +
              `${fmtSigned(m.estimatedMissedProfitQuote).padStart(9)} USDT  reason=${m.reason}`,
          );
        }
      }

      lines.push('  Top routes by paper PnL:');
      if (cell.topRoutesPaperPnL.length === 0) {
        lines.push('    (none)');
      } else {
        for (const r of cell.topRoutesPaperPnL.slice(0, 5)) {
          lines.push(
            `    ${r.buyVenue.padEnd(10)}->${r.sellVenue.padEnd(10)} ${fmtSigned(r.totalQuote).padStart(9)} USDT  trades=${r.trades}`,
          );
        }
      }

      lines.push('  Top routes by missed PnL:');
      if (cell.topRoutesMissedPnL.length === 0) {
        lines.push('    (none)');
      } else {
        for (const r of cell.topRoutesMissedPnL.slice(0, 5)) {
          lines.push(
            `    ${r.buyVenue.padEnd(10)}->${r.sellVenue.padEnd(10)} ${fmtSigned(r.totalQuote).padStart(9)} USDT  count=${r.trades}`,
          );
        }
      }

      lines.push('  Top symbols by inventory efficiency (PnL per base unit):');
      if (cell.topSymbolsEfficiency.length === 0) {
        lines.push('    (none)');
      } else {
        for (const s of cell.topSymbolsEfficiency.slice(0, 5)) {
          lines.push(
            `    ${s.symbol.padEnd(12)} ${fmtSigned(s.profitPerBase, 6).padStart(11)} USDT/base  trades=${s.trades}  totalPnL=${fmtSigned(s.totalNetProfitQuote)}`,
          );
        }
      }

      lines.push('  Final inventory drift:');
      const driftLines = formatDrift(cell.finalInventoryDrift);
      if (driftLines.length === 0) lines.push('    (none)');
      for (const dl of driftLines) lines.push(`    ${dl}`);
      lines.push('');
    }

    return lines.join('\n');
  }
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

function formatDrift(drift: PaperPortfolioJson): string[] {
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

// Make the unused param surface in the API surface for future use.
void (null as unknown as ComparisonCell | null);
