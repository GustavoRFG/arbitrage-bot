'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import clsx from 'clsx';
import { fmtMs, fmtUSDTSigned, pnlClass } from '@/lib/format';
import type { SimulationRunRow } from '@/lib/queries/simulator';

export function LatencyScenarioPicker({
  scenarios,
  selectedLatencyMs,
}: {
  scenarios: SimulationRunRow[];
  selectedLatencyMs: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="metric-label mr-2">Latency scenario</span>
      {scenarios.map((s) => {
        const active = s.latencyMs === selectedLatencyMs;
        return (
          <button
            key={s.simulationRunId}
            type="button"
            onClick={() => {
              const params = new URLSearchParams(Array.from(searchParams.entries()));
              params.set('latency', String(s.latencyMs));
              startTransition(() => router.push(`${pathname}?${params.toString()}`));
            }}
            className={clsx(
              'flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-accent-cyan/50 bg-accent-cyan/10 text-text-primary'
                : 'border-border-subtle bg-bg-panel/70 text-text-secondary hover:border-border hover:text-text-primary',
            )}
          >
            <span className="mono">{fmtMs(s.latencyMs)}</span>
            <span className={`mono text-[11px] ${pnlClass(s.totalNetProfitQuote)}`}>
              {fmtUSDTSigned(s.totalNetProfitQuote)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
