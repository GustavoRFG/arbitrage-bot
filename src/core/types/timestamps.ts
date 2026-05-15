/**
 * Disciplined timestamp tracking — Phase 1 must always distinguish *when the
 * source generated a snapshot* from *when we received it* and *when we
 * processed it*. This matters everywhere but is critical for the Polymarket
 * repricing-lag track, which measures the gap between feeds and the CLOB.
 */
export interface SourceTimestamps {
  /** Wall-clock time on the data source, when available (ms since epoch). */
  sourceTimestampMs?: number;
  /** Local wall-clock time the bytes arrived at our process (ms since epoch). */
  receivedAtMs: number;
  /** Local wall-clock time we finished normalising/processing the snapshot. */
  processedAtMs?: number;
}

export function nowMs(): number {
  return Date.now();
}

export function freshTimestamps(
  sourceTimestampMs?: number,
): SourceTimestamps {
  const t: SourceTimestamps = { receivedAtMs: nowMs() };
  if (sourceTimestampMs !== undefined) t.sourceTimestampMs = sourceTimestampMs;
  return t;
}

/**
 * True if the snapshot is older than `maxAgeMs` against `now`. Uses
 * `sourceTimestampMs` when present, otherwise `receivedAtMs`.
 */
export function isStale(
  ts: SourceTimestamps,
  maxAgeMs: number,
  now: number = nowMs(),
): boolean {
  const ref = ts.sourceTimestampMs ?? ts.receivedAtMs;
  return now - ref > maxAgeMs;
}
