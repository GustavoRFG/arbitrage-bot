import clsx from 'clsx';
import type { ReactNode } from 'react';

export function MetricCard({
  label,
  value,
  sub,
  accent,
  trend,
  align = 'left',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'cyan' | 'mint' | 'amber' | 'coral' | 'violet';
  trend?: 'up' | 'down' | 'neutral';
  align?: 'left' | 'right';
}) {
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className={clsx('flex flex-col gap-1', align === 'right' && 'text-right')}>
        <div className="flex items-center justify-between gap-2">
          <span className="metric-label">{label}</span>
          {trend && <TrendDot dir={trend} />}
        </div>
        <div className={clsx('metric-value', accent && accentClass(accent))}>{value}</div>
        {sub !== undefined && <div className="metric-sub">{sub}</div>}
      </div>
      {accent && (
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl opacity-25',
            accentBg(accent),
          )}
        />
      )}
    </div>
  );
}

function TrendDot({ dir }: { dir: 'up' | 'down' | 'neutral' }) {
  const color =
    dir === 'up' ? 'bg-signal-positive' : dir === 'down' ? 'bg-signal-negative' : 'bg-text-faint';
  return <span className={clsx('block h-1.5 w-1.5 rounded-full', color)} />;
}

function accentClass(accent: 'cyan' | 'mint' | 'amber' | 'coral' | 'violet') {
  switch (accent) {
    case 'cyan':
      return 'text-accent-cyan';
    case 'mint':
      return 'text-signal-positive';
    case 'amber':
      return 'text-accent-amber';
    case 'coral':
      return 'text-signal-negative';
    case 'violet':
      return 'text-accent-violet';
  }
}

function accentBg(accent: 'cyan' | 'mint' | 'amber' | 'coral' | 'violet') {
  switch (accent) {
    case 'cyan':
      return 'bg-accent-cyan';
    case 'mint':
      return 'bg-signal-positive';
    case 'amber':
      return 'bg-accent-amber';
    case 'coral':
      return 'bg-signal-negative';
    case 'violet':
      return 'bg-accent-violet';
  }
}
