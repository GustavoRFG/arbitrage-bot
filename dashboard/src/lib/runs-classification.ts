/**
 * Phase 2.6.1 — dashboard-level scanner-run classification.
 *
 * No data mutation: every classification is computed from existing
 * `scanner_runs` columns. The DB rows remain unchanged (some early
 * development runs were never finalized cleanly and would otherwise
 * be displayed as alarming long-running scans).
 */

export type VisualRunStatus =
  | 'active'
  | 'completed'
  | 'interrupted'
  | 'aborted'
  | 'failed'
  | 'stale_running'
  | 'empty_or_legacy';

export interface RunClassificationInput {
  status: string;
  startedAtMs: number;
  endedAtMs: number | null;
  lastActivityAtMs?: number | null;
  totalCycles: number;
  totalSymbolsScanned: number;
  totalCandidates: number;
}

export interface RunClassification {
  visualStatus: VisualRunStatus;
  /** Human-readable reason when the run is reclassified vs the raw status. */
  reason: string | null;
  /** True when the run produced no measurable scanner activity. */
  isEmpty: boolean;
  /** Age of the run in milliseconds (vs now or vs endedAt). */
  effectiveElapsedMs: number;
  /** True when the latest candidate/snapshot activity is past the stale threshold. */
  hasRecentActivity: boolean;
}

/**
 * Threshold above which a `running` row with no terminal timestamp is
 * considered stale by the dashboard. 12h is the documented default in
 * the Phase 2.6.1 spec. Twelve hours covers normal CEX scan durations
 * with healthy margin while still flagging week-old phantom rows.
 */
export const STALE_RUNNING_AGE_MS_DEFAULT = 12 * 60 * 60 * 1000;

export function classifyRun(
  input: RunClassificationInput,
  opts: { now?: number; staleAgeMs?: number } = {},
): RunClassification {
  const now = opts.now ?? Date.now();
  const staleAgeMs = opts.staleAgeMs ?? STALE_RUNNING_AGE_MS_DEFAULT;
  const isEmpty =
    input.totalCycles <= 0 &&
    input.totalSymbolsScanned <= 0 &&
    input.totalCandidates <= 0;
  const effectiveElapsedMs =
    input.endedAtMs !== null
      ? Math.max(0, input.endedAtMs - input.startedAtMs)
      : Math.max(0, now - input.startedAtMs);
  const hasRecentActivity =
    input.lastActivityAtMs !== null &&
    input.lastActivityAtMs !== undefined &&
    now - input.lastActivityAtMs <= staleAgeMs;

  if (input.status === 'completed') {
    return { visualStatus: 'completed', reason: null, isEmpty, effectiveElapsedMs, hasRecentActivity };
  }
  if (input.status === 'interrupted') {
    return { visualStatus: 'interrupted', reason: null, isEmpty, effectiveElapsedMs, hasRecentActivity };
  }
  if (input.status === 'aborted') {
    return { visualStatus: 'aborted', reason: null, isEmpty, effectiveElapsedMs, hasRecentActivity };
  }
  if (input.status === 'failed') {
    return { visualStatus: 'failed', reason: null, isEmpty, effectiveElapsedMs, hasRecentActivity };
  }

  // status === 'running' (or anything unexpected) — bucket by activity + age.
  if (input.status === 'running' && input.endedAtMs === null) {
    const hasIncompleteCounters = input.totalCycles <= 0 || input.totalSymbolsScanned <= 0;
    const shouldClassifyStale =
      effectiveElapsedMs > staleAgeMs && (hasIncompleteCounters || !hasRecentActivity);

    if (shouldClassifyStale) {
      if (isEmpty) {
        return {
          visualStatus: 'empty_or_legacy',
          reason:
            'Marked running in DB but has no cycles, no symbols and no candidates. Treated as a legacy / never-finalized row.',
          isEmpty,
          effectiveElapsedMs,
          hasRecentActivity,
        };
      }
      return {
        visualStatus: 'stale_running',
        reason:
          'Status is `running` in DB, has no terminal timestamp, and either has incomplete counters or no recent scanner activity. Treated as stale, not as an active scan.',
        isEmpty,
        effectiveElapsedMs,
        hasRecentActivity,
      };
    }
    return { visualStatus: 'active', reason: null, isEmpty, effectiveElapsedMs, hasRecentActivity };
  }

  // Unknown / unexpected raw status — fall back to "interrupted" visually so
  // it doesn't look like an active scan.
  return {
    visualStatus: 'interrupted',
    reason: `Unrecognised raw status \`${input.status}\`; defaulting to interrupted for safety.`,
    isEmpty,
    effectiveElapsedMs,
    hasRecentActivity,
  };
}

/**
 * Sort order for the Runs page:
 *   1. Meaningful runs with candidates (active / completed / interrupted
 *      with `totalCandidates > 0`), most recent first.
 *   2. Other terminal runs (interrupted / completed / aborted / failed).
 *   3. Stale_running rows (status=running but old + activity).
 *   4. Empty_or_legacy rows (no cycles / no symbols / no candidates).
 */
export function runSortKey(
  classification: VisualRunStatus,
  hasCandidates: boolean,
  startedAtMs: number,
): [number, number] {
  if (classification === 'empty_or_legacy') return [3, -startedAtMs];
  if (classification === 'stale_running') return [2, -startedAtMs];
  if (
    (classification === 'active' ||
      classification === 'completed' ||
      classification === 'interrupted') &&
    hasCandidates
  ) {
    return [0, -startedAtMs];
  }
  return [1, -startedAtMs];
}
