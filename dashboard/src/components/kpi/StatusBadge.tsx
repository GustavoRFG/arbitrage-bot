import clsx from 'clsx';

type Status = 'running' | 'completed' | 'interrupted' | 'aborted' | 'failed' | 'unknown';

const TONE: Record<Status, { dot: string; label: string; pill: string }> = {
  running: {
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
  unknown: {
    dot: 'bg-text-faint',
    pill: 'border-border-subtle bg-bg-elevated text-text-faint',
    label: 'UNKNOWN',
  },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONE[(status as Status) in TONE ? (status as Status) : 'unknown']!;
  const isRunning = status === 'running';
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
