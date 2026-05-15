/**
 * A pluggable clock so tests don't depend on wall time.
 */
export interface Clock {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function fixedClock(initialMs: number): Clock & {
  advance(ms: number): void;
  set(ms: number): void;
} {
  let t = initialMs;
  return {
    nowMs: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}
