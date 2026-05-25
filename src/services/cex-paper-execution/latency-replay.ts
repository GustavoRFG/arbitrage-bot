import type {
  CandidateEstimateRow,
  LifecycleWithEstimates,
} from './paper-trade-types.js';

export interface LatencyReplayResult {
  /** Estimates whose detected_at >= lifecycle.firstSeenAtMs + latencyMs. */
  survivingEstimates: CandidateEstimateRow[];
  /**
   * True when the lifecycle was too short to survive the latency at all (i.e.
   * no observations made it past `firstSeenAtMs + latencyMs`). The simulator
   * records this as a 'lifecycle_too_short_for_latency' rejection.
   */
  expiredBeforeLatency: boolean;
  /** Trade-execution timestamp for the first surviving estimate, if any. */
  executedAtMs?: number;
}

/**
 * Lifecycle-aware precise candidate-timestamp replay.
 *
 * For a lifecycle whose first sighting is at `t0`, with simulator latency `L`,
 * we model the trader as only able to react at `t0 + L`. So we keep only the
 * estimates whose underlying candidate was detected at or after that
 * threshold. If the lifecycle ended before `t0 + L`, nothing survives and the
 * caller treats it as a `lifecycle_too_short_for_latency` rejection.
 *
 * This is the precise replay flavour referenced in the project brief — coarser
 * "duration >= latency" approximations would systematically over-execute
 * because they ignore *which observation* the trader actually acts on.
 */
export function replayWithLatency(
  lifecycle: LifecycleWithEstimates,
  latencyMs: number,
): LatencyReplayResult {
  if (latencyMs <= 0) {
    const first = lifecycle.estimates[0];
    const result: LatencyReplayResult = {
      survivingEstimates: lifecycle.estimates.slice(),
      expiredBeforeLatency: lifecycle.estimates.length === 0,
    };
    if (first) result.executedAtMs = first.detectedAtMs;
    return result;
  }

  const threshold = lifecycle.firstSeenAtMs + latencyMs;
  if (threshold > lifecycle.lastSeenAtMs) {
    return { survivingEstimates: [], expiredBeforeLatency: true };
  }
  const surviving = lifecycle.estimates.filter((e) => e.detectedAtMs >= threshold);
  if (surviving.length === 0) {
    return { survivingEstimates: [], expiredBeforeLatency: true };
  }
  return {
    survivingEstimates: surviving,
    expiredBeforeLatency: false,
    executedAtMs: surviving[0]!.detectedAtMs,
  };
}
