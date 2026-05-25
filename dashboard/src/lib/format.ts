/**
 * Number / time / venue formatters shared across the dashboard.
 *
 * Number output uses `Intl.NumberFormat` so locale-aware grouping is
 * consistent (and so tests don't drift between en-US and en-GB defaults).
 */

const NF_PROFIT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NF_INT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const NF_PCT_4 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const NF_COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function fmtUSDT(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (decimals === 2) return NF_PROFIT.format(n);
  return n.toFixed(decimals);
}

export function fmtUSDTSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const formatted = NF_PROFIT.format(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return NF_INT.format(n);
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return NF_COMPACT.format(n);
}

export function fmtPct(n: number | null | undefined, decimals = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (decimals === 4) return `${NF_PCT_4.format(n)}%`;
  return `${n.toFixed(decimals)}%`;
}

export function fmtMs(ms: number): string {
  return `${NF_INT.format(ms)}ms`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1_000) return `${ms.toFixed(0)}ms`;
  const sec = ms / 1_000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) {
    const m = Math.floor(min);
    const s = Math.floor(sec - m * 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  const h = Math.floor(min / 60);
  const m = Math.floor(min - h * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function fmtRoute(buy: string, sell: string): string {
  return `${buy} → ${sell}`;
}

export function fmtAsset(qty: number, asset: string): string {
  if (Math.abs(qty) >= 1_000_000) return `${fmtCompact(qty)} ${asset}`;
  if (Math.abs(qty) >= 100) return `${NF_PROFIT.format(qty)} ${asset}`;
  return `${qty.toFixed(4)} ${asset}`;
}

export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'text-text-secondary';
  if (n > 0) return 'text-signal-positive';
  if (n < 0) return 'text-signal-negative';
  return 'text-text-secondary';
}
