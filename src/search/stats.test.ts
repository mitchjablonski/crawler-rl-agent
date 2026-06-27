import { describe, expect, it } from 'vitest';
import { fmtRateCI, wilsonInterval } from './stats.js';

describe('wilsonInterval', () => {
  it('brackets the point estimate and stays within [0,1]', () => {
    const ci = wilsonInterval(18, 20); // 90%
    expect(ci.rate).toBeCloseTo(0.9);
    expect(ci.lo).toBeGreaterThan(0);
    expect(ci.lo).toBeLessThan(0.9);
    expect(ci.hi).toBeGreaterThan(0.9);
    expect(ci.hi).toBeLessThanOrEqual(1);
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

  it('fmtRateCI renders rate + interval', () => {
    expect(fmtRateCI(0.9, 20)).toMatch(/^90\.0% \[\d+–\d+\]$/);
  });
});
