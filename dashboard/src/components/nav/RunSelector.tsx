'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import clsx from 'clsx';
import { StatusBadge } from '../kpi/StatusBadge';
import { fmtDuration, fmtInt, fmtTime } from '@/lib/format';

export interface RunSelectorRun {
  runId: string;
  status: string;
  startedAtMs: number;
  endedAtMs: number | null;
  actualElapsedMs: number | null;
  totalCandidates: number;
  totalMaterialCandidates: number;
}

export function RunSelector({
  runs,
  selectedRunId,
}: {
  runs: RunSelectorRun[];
  selectedRunId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const onSelect = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set('run', runId);
      // Reset sub-selections that are scoped to a particular run.
      params.delete('sim');
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
      setOpen(false);
    },
    [router, pathname, searchParams],
  );

  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'group flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-bg-panel/80 px-3 py-2 text-left transition-colors hover:border-border',
          open && 'border-border',
        )}
      >
        <span className="metric-label text-text-muted">Scanner run</span>
        {selected ? (
          <>
            <span className="mono text-sm text-text-primary">{selected.runId}</span>
            <StatusBadge status={selected.status} />
            <span className="ml-auto text-[11px] text-text-muted">
              {fmtTime(selected.startedAtMs)} · {fmtDuration(
                selected.actualElapsedMs ?? (selected.endedAtMs ? selected.endedAtMs - selected.startedAtMs : Date.now() - selected.startedAtMs),
              )}
            </span>
          </>
        ) : (
          <span className="text-sm text-text-muted">No runs available</span>
        )}
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          className={clsx(
            'ml-2 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && runs.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[480px] overflow-auto rounded-lg border border-border bg-bg-elevated shadow-2xl">
          {runs.map((r) => {
            const active = r.runId === selectedRunId;
            return (
              <button
                key={r.runId}
                type="button"
                onClick={() => onSelect(r.runId)}
                className={clsx(
                  'flex w-full items-center gap-3 border-b border-border-subtle/60 px-3 py-2 text-left text-sm transition-colors hover:bg-bg-panel/60',
                  active && 'bg-bg-panel/40',
                )}
              >
                <span className="mono text-[13px] text-text-primary">{r.runId}</span>
                <StatusBadge status={r.status} />
                <span className="ml-auto flex items-center gap-4 text-[11px] text-text-muted">
                  <span>{fmtTime(r.startedAtMs)}</span>
                  <span className="num text-text-secondary">
                    candidates: {fmtInt(r.totalCandidates)}
                  </span>
                  <span className="num text-text-secondary">
                    material: {fmtInt(r.totalMaterialCandidates)}
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
