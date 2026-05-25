import type { DominantRegime } from '@/lib/regime';

export function RegimeCallout({ regime }: { regime: DominantRegime | null }) {
  if (!regime) {
    return (
      <div className="panel relative overflow-hidden p-5">
        <div className="metric-label mb-1">Current regime</div>
        <p className="text-sm text-text-secondary">
          No single-symbol regime is dominant yet — opportunities are spread across the universe.
        </p>
      </div>
    );
  }

  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent-cyan blur-3xl opacity-10" />
      <div className="absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-accent-violet blur-3xl opacity-10" />
      <div className="relative">
        <div className="heading-eyebrow mb-1">Current dominant regime</div>
        <h3 className="text-xl font-semibold tracking-tight text-text-primary">
          {regime.description}
        </h3>
        {regime.routes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {regime.routes.map((r) => (
              <span key={`${r.buyExchange}|${r.sellExchange}`} className="pill mono">
                <span className="text-text-primary">{r.buyExchange}</span>
                <span className="text-text-muted">→</span>
                <span className="text-text-primary">{r.sellExchange}</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-secondary">{r.rawCandidates}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
