import type { UniverseMetadata } from '@/lib/queries/observatory';

export function UniverseMetadataCard({ universe }: { universe: UniverseMetadata | null }) {
  if (!universe) {
    return (
      <div className="panel p-4">
        <div className="metric-label mb-2">Universe</div>
        <p className="text-sm text-text-secondary">
          No universe metadata captured (older run or pre-migration scan).
        </p>
      </div>
    );
  }

  const preview =
    universe.resolvedSymbols.length <= 8
      ? universe.resolvedSymbols
      : universe.resolvedSymbols.slice(0, 8);

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="metric-label">Universe</span>
        <span className="pill">{universe.symbolMode}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">Resolved symbols</dt>
        <dd className="num">{universe.resolvedSymbols.length}</dd>
        <dt className="text-text-muted">Enabled exchanges</dt>
        <dd className="num">{universe.enabledExchanges.length}</dd>
        <dt className="text-text-muted">Min venues / symbol</dt>
        <dd className="num">{universe.minVenuesPerSymbol}</dd>
        <dt className="text-text-muted">Max symbols (cap)</dt>
        <dd className="num">{universe.maxSymbols}</dd>
        <dt className="text-text-muted">Universe truncated</dt>
        <dd className="num">{universe.truncated ? 'yes' : 'no'}</dd>
      </dl>
      <div className="mt-4">
        <div className="metric-label mb-2">Exchanges</div>
        <div className="flex flex-wrap gap-1.5">
          {universe.enabledExchanges.map((ex) => (
            <span key={ex} className="pill mono">{ex}</span>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <div className="metric-label mb-2">Symbols preview</div>
        <div className="flex flex-wrap gap-1.5">
          {preview.map((s) => (
            <span key={s} className="pill mono">{s}</span>
          ))}
          {universe.resolvedSymbols.length > preview.length && (
            <span className="pill mono text-text-muted">
              +{universe.resolvedSymbols.length - preview.length} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
