'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import clsx from 'clsx';
import type { SimulationFamily } from '@/lib/queries/simulator';
import { fmtTime, fmtUSDT, fmtUSDTSigned } from '@/lib/format';

export function SimulationFamilySelector({
  families,
  selectedFamilyId,
}: {
  families: SimulationFamily[];
  selectedFamilyId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const onSelect = useCallback(
    (familyId: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set('sim', familyId);
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
      setOpen(false);
    },
    [router, pathname, searchParams],
  );

  if (families.length === 0) return null;
  const selected = families.find((f) => f.familyId === selectedFamilyId) ?? families[0]!;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-bg-panel/80 px-3 py-2 text-left transition-colors hover:border-border',
          open && 'border-border',
        )}
      >
        <span className="metric-label text-text-muted">Simulation family</span>
        <span className="mono text-sm text-text-primary">{selected.policyName}</span>
        <span className="pill mono">{selected.selectionMode}</span>
        <span className="pill mono">{selected.scenarios.length} latency scenarios</span>
        <span className="ml-auto text-[11px] text-text-muted">
          {fmtTime(selected.createdAtMs)} · best{' '}
          <span className="num text-signal-positive">
            {fmtUSDTSigned(Math.max(0, ...selected.scenarios.map((s) => s.totalNetProfitQuote)))} USDT
          </span>
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[420px] overflow-auto rounded-lg border border-border bg-bg-elevated shadow-2xl">
          {families.map((f) => {
            const active = f.familyId === selectedFamilyId;
            const best = Math.max(0, ...f.scenarios.map((s) => s.totalNetProfitQuote));
            return (
              <button
                key={f.familyId}
                type="button"
                onClick={() => onSelect(f.familyId)}
                className={clsx(
                  'flex w-full items-center gap-3 border-b border-border-subtle/60 px-3 py-2 text-left text-sm hover:bg-bg-panel/60',
                  active && 'bg-bg-panel/40',
                )}
              >
                <span className="mono text-text-primary">{f.policyName}</span>
                <span className="pill mono">{f.selectionMode}</span>
                <span className="pill mono">
                  min profit {fmtUSDT(f.minProfitQuote)} · spread {f.minSpreadPct}%
                </span>
                <span className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
                  <span>{fmtTime(f.createdAtMs)}</span>
                  <span className="num text-text-secondary">
                    {f.scenarios.length} latencies
                  </span>
                  <span className="num text-signal-positive">
                    {fmtUSDTSigned(best)} USDT
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
