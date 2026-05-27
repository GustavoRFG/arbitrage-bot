import Link from 'next/link';
import clsx from 'clsx';
import { fmtInt, fmtPct, fmtUSDT, fmtUSDTSigned, pnlClass } from '@/lib/format';
import type { ComparisonRunRow } from '@/lib/queries/comparison';
import type { RejectionReason } from '@/lib/queries/simulator';

export interface RegimeCardsInput {
  scannerRunId: string;
  rawRegime: {
    topSymbol: string | null;
    sellSink: string | null;
    sourceVenues: string[];
    description: string | null;
  };
  actionable: {
    topSymbol: string | null;
    tradableRatio: number;
    medianPositiveEstimate: number | null;
    maxPositiveEstimate: number | null;
    prefundedTradableCount: number;
    estimatesCalculated: number;
  };
  comparison: ComparisonRunRow | null;
}

const REASON_LABEL: Record<RejectionReason, string> = {
  insufficient_base_inventory: 'insufficient base inventory',
  insufficient_quote_inventory: 'insufficient quote inventory',
  lifecycle_too_short_for_latency: 'lifecycle shorter than required latency',
  latency_expired: 'latency expired before execution',
  below_threshold: 'below policy thresholds',
  no_eligible_estimate: 'no eligible estimate',
};

const EMPTY_CMD = (runId: string) =>
  [
    'npx tsx src/cli/paper-cex-compare.ts `',
    `  --run=${runId} \``,
    "  --symbols='OP/USDT,PYTH/USDT,TIA/USDT,SUI/USDT,AAVE/USDT' `",
    "  --latencies='0,1000,3000,5000,10000' `",
    '  --contention=multi_route',
  ].join('\n');

export function RegimeComparisonCards({
  scannerRunId,
  rawRegime,
  actionable,
  comparison,
}: RegimeCardsInput) {
  const compareHref = comparison
    ? `/compare?run=${scannerRunId}&comparison=${comparison.comparisonRunId}`
    : `/compare?run=${scannerRunId}`;

  const captureRatio =
    comparison && comparison.bestTotalNetProfitQuote !== null
      ? (() => {
          const best = Math.max(0, comparison.bestTotalNetProfitQuote);
          const missed = Math.max(0, comparison.totalMissedProfitQuote ?? 0);
          return best + missed > 0 ? best / (best + missed) : 0;
        })()
      : null;

  return (
    <section className="grid gap-3 lg:grid-cols-4">
      <RegimeCard
        eyebrow="Raw regime"
        title={rawRegime.topSymbol ?? '—'}
        sub={
          rawRegime.sellSink
            ? `dominant sink: ${rawRegime.sellSink.toUpperCase()}`
            : 'diffuse'
        }
        body={
          rawRegime.description ??
          'Driven by total raw candidate count and dominant lifecycles in the Observatory.'
        }
        accent="cyan"
      />
      <RegimeCard
        eyebrow="Actionable regime"
        title={actionable.topSymbol ?? '—'}
        sub={`tradable ratio ${fmtPct(actionable.tradableRatio * 100, 2)}`}
        body={
          actionable.maxPositiveEstimate !== null
            ? `Max executable net profit ${fmtUSDT(actionable.maxPositiveEstimate)} USDT · ` +
              `${fmtInt(actionable.prefundedTradableCount)} / ${fmtInt(actionable.estimatesCalculated)} prefunded+tradable estimates.`
            : 'No prefunded+tradable estimates yet — actionable signal still emerging.'
        }
        accent="mint"
      />
      {comparison ? (
        <RegimeCard
          eyebrow="Capturable regime"
          title={
            <span>
              <span className="mono">{comparison.bestPreset ?? '—'}</span>
              {comparison.bestLatencyMs !== null && (
                <span className="text-text-secondary">
                  {' '}
                  · {fmtInt(comparison.bestLatencyMs)}ms
                </span>
              )}
            </span>
          }
          sub={
            <span className={clsx('mono', pnlClass(comparison.bestTotalNetProfitQuote ?? 0))}>
              {fmtUSDTSigned(comparison.bestTotalNetProfitQuote)} USDT
            </span>
          }
          body={
            <span>
              Capture ratio{' '}
              <span className="mono text-accent-cyan">
                {captureRatio !== null ? fmtPct(captureRatio * 100, 2) : '—'}
              </span>{' '}
              after inventory + latency constraints.{' '}
              <Link href={compareHref} className="text-accent-cyan hover:underline">
                Open comparison →
              </Link>
            </span>
          }
          accent="violet"
        />
      ) : (
        <RegimeCard
          eyebrow="Capturable regime"
          title="No comparison yet"
          sub="run paper:cex:compare"
          body={
            <pre className="mt-2 overflow-auto rounded-md border border-border-subtle bg-bg-base px-2 py-2 text-[10px] text-accent-cyan">
              {EMPTY_CMD(scannerRunId)}
            </pre>
          }
          accent="violet"
          muted
        />
      )}
      {comparison && comparison.topBottleneckReason ? (
        <RegimeCard
          eyebrow="Main bottleneck"
          title={REASON_LABEL[comparison.topBottleneckReason] ?? comparison.topBottleneckReason}
          sub={
            <span className="mono text-accent-amber">
              missed ≈ {fmtUSDT(comparison.totalMissedProfitQuote ?? 0)} USDT
            </span>
          }
          body={
            <span>
              Highest-value rejection cause aggregated across the comparison grid.{' '}
              <Link href={compareHref} className="text-accent-cyan hover:underline">
                Break it down →
              </Link>
            </span>
          }
          accent="amber"
        />
      ) : (
        <RegimeCard
          eyebrow="Main bottleneck"
          title={comparison ? 'No missed PnL detected' : 'Awaiting comparison'}
          sub={
            comparison
              ? 'all simulated lifecycles either captured value or had no upside.'
              : 'will appear after paper:cex:compare persists data.'
          }
          body={comparison ? null : <span>Use the CLI command in the Capturable card.</span>}
          accent="amber"
          muted={!comparison}
        />
      )}
    </section>
  );
}

function RegimeCard({
  eyebrow,
  title,
  sub,
  body,
  accent,
  muted = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  body: React.ReactNode;
  accent: 'cyan' | 'mint' | 'violet' | 'amber';
  muted?: boolean;
}) {
  return (
    <div
      className={clsx(
        'panel relative flex flex-col gap-2 overflow-hidden p-4',
        muted && 'opacity-80',
      )}
    >
      <div className="metric-label flex items-center justify-between">
        <span>{eyebrow}</span>
        <span
          aria-hidden
          className={clsx(
            'inline-block h-1.5 w-1.5 rounded-full',
            accent === 'cyan' && 'bg-accent-cyan',
            accent === 'mint' && 'bg-signal-positive',
            accent === 'violet' && 'bg-accent-violet',
            accent === 'amber' && 'bg-accent-amber',
          )}
        />
      </div>
      <div className={clsx('text-base font-semibold leading-tight', muted && 'text-text-secondary')}>
        {title}
      </div>
      <div className="text-[11px] text-text-muted">{sub}</div>
      {body && <div className="mt-1 text-[12px] leading-relaxed text-text-secondary">{body}</div>}
    </div>
  );
}
