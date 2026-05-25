import clsx from 'clsx';

export function LeaderboardBar({
  value,
  max,
  accent = 'cyan',
}: {
  value: number;
  max: number;
  accent?: 'cyan' | 'teal' | 'mint' | 'amber' | 'coral' | 'violet';
}) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  const gradient = (() => {
    switch (accent) {
      case 'teal':
        return 'from-accent-teal/80 to-accent-teal/10';
      case 'mint':
        return 'from-signal-positive/80 to-signal-positive/10';
      case 'amber':
        return 'from-accent-amber/80 to-accent-amber/10';
      case 'coral':
        return 'from-signal-negative/80 to-signal-negative/10';
      case 'violet':
        return 'from-accent-violet/80 to-accent-violet/10';
      default:
        return 'from-accent-cyan/80 to-accent-cyan/10';
    }
  })();
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
      <div
        className={clsx('h-full rounded-full bg-gradient-to-r', gradient)}
        style={{ width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}
