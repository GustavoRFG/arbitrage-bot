'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import clsx from 'clsx';

interface PresetOption {
  name: string;
  label: string;
}

interface Props {
  presets: PresetOption[];
  latencies: number[];
  selectedPreset: string;
  selectedLatencyMs: number;
}

export function ComparisonScenarioPicker({
  presets,
  latencies,
  selectedPreset,
  selectedLatencyMs,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function navigate(updates: Record<string, string>): void {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) next.set(k, v);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="panel flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="metric-label">Preset</span>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => navigate({ preset: p.name })}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-xs transition',
                p.name === selectedPreset
                  ? 'border-accent-cyan/70 bg-accent-cyan/10 text-accent-cyan'
                  : 'border-border-subtle bg-bg-panel text-text-secondary hover:text-text-primary',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="metric-label">Latency</span>
        <div className="flex flex-wrap gap-1">
          {latencies.map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => navigate({ latency: String(ms) })}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-xs transition',
                ms === selectedLatencyMs
                  ? 'border-accent-mint/70 bg-accent-mint/10 text-accent-mint'
                  : 'border-border-subtle bg-bg-panel text-text-secondary hover:text-text-primary',
              )}
            >
              {ms}ms
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
