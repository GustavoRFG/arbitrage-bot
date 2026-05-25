'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';

const POLL_INTERVAL_MS = 20_000;

/**
 * Background "live" pulse — polls the current route every 20s by calling
 * `router.refresh()`, which re-runs server components against the latest
 * SQLite state. The button is also clickable for an instant refresh, and
 * shows the last-refreshed timestamp so the user can trust freshness.
 */
export function LiveRefreshIndicator() {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now());
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      startTransition(() => {
        router.refresh();
        setLastRefresh(Date.now());
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router, enabled]);

  const seconds = useRelativeSeconds(lastRefresh);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-panel/70 px-2.5 py-1">
      <button
        type="button"
        title={enabled ? 'Pause auto-refresh' : 'Resume auto-refresh'}
        onClick={() => setEnabled((v) => !v)}
        className="grid h-5 w-5 place-items-center text-text-muted transition-colors hover:text-text-primary"
      >
        <span
          className={clsx(
            'block h-2 w-2 rounded-full',
            enabled ? 'bg-signal-positive shadow-[0_0_8px_rgba(90,245,168,0.7)]' : 'bg-text-faint',
          )}
        />
      </button>
      <button
        type="button"
        onClick={() => {
          startTransition(() => {
            router.refresh();
            setLastRefresh(Date.now());
          });
        }}
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-text-secondary transition-colors hover:text-text-primary"
      >
        <span
          className={clsx('mono', isPending ? 'text-accent-cyan' : 'text-text-secondary')}
        >
          {isPending ? 'refreshing…' : `live · ${seconds}s ago`}
        </span>
      </button>
    </div>
  );
}

function useRelativeSeconds(timestamp: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - timestamp) / 1_000));
}
