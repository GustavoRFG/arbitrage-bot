import clsx from 'clsx';

type Status =
  | 'running'
  | 'active'
  | 'completed'
  | 'interrupted'
  | 'aborted'
  | 'failed'
  | 'stale_running'
  | 'empty_or_legacy'
  | 'unknown';

const TONE: Record<Status, { dot: string; label: string; pill: string }> = {
  running: {
    dot: 'dot-running',
    pill: 'border-signal-positive/30 bg-signal-positive/10 text-signal-positive',
    label: 'RUNNING',
  },
  // Phase 2.6.1 — visual-only "active" is the dashboard-classified equivalent
  // of `running` for a run within the stale threshold. We keep the same
  // signal-positive tone so the user reads it as a healthy live scan.
  active: {
    dot: 'dot-running',
    pill: 'border-signal-positive/30 bg-signal-positive/10 text-signal-positive',
    label: 'RUNNING',
  },
  completed: {
    dot: 'bg-text-secondary',
    pill: 'border-border-subtle bg-bg-elevated text-text-secondary',
    label: 'COMPLETED',
  },
  interrupted: {
    dot: 'bg-accent-amber',
    pill: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
    label: 'INTERRUPTED',
  },
  aborted: {
    dot: 'bg-signal-negative',
    pill: 'border-signal-negative/30 bg-signal-negative/10 text-signal-negative',
    label: 'ABORTED',
  },
  failed: {
    dot: 'bg-signal-negative',
    pill: 'border-signal-negative/30 bg-signal-negative/10 text-signal-negative',
    label: 'FAILED',
  },
  // Phase 2.6.1 — early-development rows that were never finalized cleanly:
  // status='running' in DB but no recent activity. Rendered as a muted
  // warning so they don't pretend to be alive.
  stale_running: {
    dot: 'bg-accent-amber/70',
    pill: 'border-accent-amber/30 bg-accent-amber/5 text-accent-amber/80',
    label: 'STALE',
  },
  empty_or_legacy: {
    dot: 'bg-text-faint',
    pill: 'border-border-subtle bg-bg-elevated text-text-faint',
    label: 'LEGACY EMPTY',
  },
  unknown: {
    dot: 'bg-text-faint',
    pill: 'border-border-subtle bg-bg-elevated text-text-faint',
    label: 'UNKNOWN',
  },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONE[(status as Status) in TONE ? (status as Status) : 'unknown']!;
  const isRunning = status === 'running' || status === 'active';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.15em]',
        tone.pill,
        className,
      )}
    >
      <span
        aria-hidden
        className={clsx(
          isRunning ? 'dot-running' : 'block h-1.5 w-1.5 rounded-full',
          !isRunning && tone.dot,
        )}
      />
      {tone.label}
    </span>
  );
}
