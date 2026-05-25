import type { UniverseMetadata } from '@/lib/queries/observatory';

export function MaterialRuleCard({
  universe,
  totalMaterialCandidates,
  totalCandidates,
}: {
  universe: UniverseMetadata | null;
  totalMaterialCandidates: number;
  totalCandidates: number;
}) {
  const ratio = totalCandidates > 0 ? totalMaterialCandidates / totalCandidates : 0;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="metric-label">Material rule</span>
        <span className="pill mono">{(ratio * 100).toFixed(1)}% pass-rate</span>
      </div>
      {universe ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-text-secondary">
            {universe.materialRule.description}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">Min net profit (quote)</dt>
            <dd className="num">{universe.materialRule.minNetProfitQuote}</dd>
            <dt className="text-text-muted">Min net spread %</dt>
            <dd className="num">{universe.materialRule.minExecutableNetSpreadPct}</dd>
          </dl>
        </>
      ) : (
        <p className="text-sm text-text-secondary">
          Material rule thresholds not captured for this run.
        </p>
      )}
      <div className="mt-4 flex items-baseline justify-between border-t border-border-subtle pt-3">
        <span className="metric-label">Material vs raw</span>
        <span className="mono text-sm text-text-primary tabular">
          {totalMaterialCandidates.toLocaleString()} / {totalCandidates.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
