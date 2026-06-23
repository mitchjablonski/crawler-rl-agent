import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter.js';

const config = () => ({ capacity: 2, refillPerMinute: 1 });

describe('createLimiter', () => {
  it('caps a burst at bucket capacity', () => {
    const t = 0;
    const limiter = createLimiter(config, () => t);
    const results = Array.from({ length: 50 }, () => limiter.tryTake('x'));
    expect(results.filter(Boolean)).toHaveLength(2);
  });

  it('refills over time up to capacity', () => {
    let t = 0;
    const limiter = createLimiter(config, () => t);
    expect(limiter.tryTake('x')).toBe(true);
    expect(limiter.tryTake('x')).toBe(true);
    expect(limiter.tryTake('x')).toBe(false);

    t += 60_000; // one minute: one token back
    expect(limiter.tryTake('x')).toBe(true);
    expect(limiter.tryTake('x')).toBe(false);

    t += 10 * 60_000; // long idle: capped at capacity, not 10 tokens
    expect(limiter.tryTake('x')).toBe(true);
    expect(limiter.tryTake('x')).toBe(true);
    expect(limiter.tryTake('x')).toBe(false);
  });

  it('accumulates fractional refill', () => {
    let t = 0;
    const limiter = createLimiter(() => ({ capacity: 1, refillPerMinute: 0.5 }), () => t);
    expect(limiter.tryTake('x')).toBe(true);
    t += 60_000; // half a token
    expect(limiter.tryTake('x')).toBe(false);
    t += 60_000; // full token
    expect(limiter.tryTake('x')).toBe(true);
  });

  it('keys are independent buckets', () => {
    const t = 0;
    const limiter = createLimiter(config, () => t);
    expect(limiter.tryTake('a')).toBe(true);
    expect(limiter.tryTake('a')).toBe(true);
    expect(limiter.tryTake('a')).toBe(false);
    expect(limiter.tryTake('b')).toBe(true);
  });
});
