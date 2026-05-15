/**
 * Generic lifecycle base. Both CEX arbitrage opportunities and Polymarket
 * repricing lag events are *episodes*, not point-in-time samples — they open,
 * persist for some duration and close. Treating each loop iteration as a new
 * event would inflate counts and lose duration data.
 */
export interface LifecycleEventBase {
  id: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  observationCount: number;
  status: 'open' | 'closed';
}

export interface LifecycleStorePolicy {
  /** Grace period after the last sighting before the lifecycle is closed. */
  closeGraceMs: number;
}
