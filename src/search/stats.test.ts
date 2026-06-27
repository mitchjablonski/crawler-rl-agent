import { describe, expect, it } from 'vitest';
import { fmtRateCI, wilsonInterval } from './stats.js';

describe('wilsonInterval', () => {
  it('matches the exact Wilson bounds for 18/20 (pins the formula constants)', () => {
    const ci = wilsonInterval(18, 20); // 90%
    expect(ci.rate).toBeCloseTo(0.9);
    expect(ci.lo).toBeCloseTo(0.6990, 3); // standard Wilson 95% lower bound
    expect(ci.hi).toBeCloseTo(0.9721, 3); //                   upper bound
    expect(ci.hi - ci.lo).toBeGreaterThan(0.1); // 20 seeds is a wide interval
  });

  it('a perfect score still has an upper-bounded, non-degenerate lower bound', () => {
    const ci = wilsonInterval(20, 20); // 100%
    expect(ci.hi).toBeLessThanOrEqual(1);
    expect(ci.lo).toBeGreaterThan(0.8); // not 1.0 — 20/20 doesn't prove 100%
    expect(ci.lo).toBeLessThan(1);
  });

  it('shrinks as n grows', () => {
    const small = wilsonInterval(45, 50);
    const big = wilsonInterval(450, 500);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });

  it('handles n=0 without NaN', () => {
    expect(wilsonInterval(0, 0)).toEqual({ rate: 0, lo: 0, hi: 0 });
  });

  it('fmtRateCI renders rate + interval, incl. a rate that does not divide evenly', () => {
    expect(fmtRateCI(0.9, 20)).toBe('90.0% [70–97]');
    expect(fmtRateCI(1 / 3, 40)).toMatch(/^33\.3% \[\d+–\d+\]$/); // round-trips successes=13
  });
});
