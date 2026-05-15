import { polymarketLagKey } from '../../core/types/event.js';

import type { Database as BetterDb } from 'better-sqlite3';
import type { RepricingLagCandidate } from '../../core/types/polymarket.js';

/**
 * Polymarket-side lifecycle tracker. Mirrors the CEX lifecycle pattern:
 * group point-in-time candidates by (market, event_type), persist a single
 * episode that grows while sightings keep coming, and close it after a
 * grace period of silence.
 */
export class RepricingLifecycleTracker {
  constructor(
    private readonly db: BetterDb,
    private readonly closeGraceMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  recordObservation(runId: string | null, c: RepricingLagCandidate): number {
    const eventKey = polymarketLagKey(c.marketId, c.eventType);
    const existing = this.db
      .prepare(
        `SELECT id, max_reference_move_pct, max_distance_from_open_pct, max_lag_ms_estimate
         FROM repricing_lag_lifecycles
         WHERE event_key = ? AND status = 'open'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(eventKey) as
      | {
          id: number;
          max_reference_move_pct: number | null;
          max_distance_from_open_pct: number | null;
          max_lag_ms_estimate: number | null;
        }
      | undefined;

    if (!existing) {
      const r = this.db
        .prepare(
          `INSERT INTO repricing_lag_lifecycles
           (run_id, market_id, event_key, event_type, first_seen_at, last_seen_at,
            observation_count, status, max_reference_move_pct,
            max_distance_from_open_pct, max_lag_ms_estimate, repriced_flag)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'open', ?, ?, ?, 0)`,
        )
        .run(
          runId,
          c.marketId,
          eventKey,
          c.eventType,
          c.detectedAtMs,
          c.detectedAtMs,
          c.referenceMovePct ?? null,
          c.distanceFromOpenPct ?? null,
          c.lagMsEstimate ?? null,
        );
      return Number(r.lastInsertRowid);
    }

    const newMaxRef = max(existing.max_reference_move_pct, c.referenceMovePct);
    const newMaxDist = max(existing.max_distance_from_open_pct, c.distanceFromOpenPct);
    const newMaxLag = max(existing.max_lag_ms_estimate, c.lagMsEstimate);
    this.db
      .prepare(
        `UPDATE repricing_lag_lifecycles
         SET last_seen_at = ?, observation_count = observation_count + 1,
             max_reference_move_pct = ?, max_distance_from_open_pct = ?,
             max_lag_ms_estimate = ?
         WHERE id = ?`,
      )
      .run(c.detectedAtMs, newMaxRef, newMaxDist, newMaxLag, existing.id);
    return existing.id;
  }

  closeIdleLifecycles(): number {
    const cutoff = this.nowMs() - this.closeGraceMs;
    const r = this.db
      .prepare(
        `UPDATE repricing_lag_lifecycles
         SET status = 'closed', ended_at = last_seen_at,
             duration_ms = (last_seen_at - first_seen_at)
         WHERE status = 'open' AND last_seen_at < ?`,
      )
      .run(cutoff);
    return r.changes;
  }
}

function max(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  if (a == null) return b!;
  if (b == null) return a;
  return Math.abs(a) >= Math.abs(b) ? a : b;
}
