import { systemClock, type Clock } from '../time/clock.js';

export interface RetryOptions {
  attempts: number;          // total attempts including the first
  baseDelayMs: number;
  maxDelayMs?: number;
  factor?: number;           // exponential factor, default 2
  clock?: Clock;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

/**
 * Minimal exponential-backoff retry. Defaults to retrying every error.
 * Returns the resolved value or rethrows the final error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    attempts,
    baseDelayMs,
    maxDelayMs = 10_000,
    factor = 2,
    clock = systemClock,
    shouldRetry = () => true,
  } = options;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < attempts) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
      await clock.sleep(delay);
    }
  }
  throw lastErr;
}
