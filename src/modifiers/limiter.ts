export interface BucketConfig {
  readonly capacity: number;
  readonly refillPerMinute: number;
}

export interface RateLimiter {
  /** Spend one token for this key if available. */
  tryTake(key: string): boolean;
}

export function createLimiter(
  configFor: (key: string) => BucketConfig,
  now: () => number = Date.now,
): RateLimiter {
  const buckets = new Map<string, { tokens: number; last: number }>();

  return {
    tryTake(key: string): boolean {
      const config = configFor(key);
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: config.capacity, last: t };
        buckets.set(key, bucket);
      }
      const elapsedMinutes = Math.max(0, t - bucket.last) / 60_000;
      bucket.tokens = Math.min(
        config.capacity,
        bucket.tokens + elapsedMinutes * config.refillPerMinute,
      );
      bucket.last = t;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    },
  };
}
