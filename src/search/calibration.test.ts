import { describe, expect, it } from 'vitest';
import { binCalibration } from './calibration.js';

describe('binCalibration', () => {
  it('a perfectly calibrated set has ~0 overconfidence and ECE', () => {
    // pred == real everywhere.
    const preds = [0.05, 0.15, 0.35, 0.55, 0.75, 0.95];
    const cal = binCalibration(preds, [...preds], 10);
    expect(cal.overconfidence).toBeCloseTo(0, 6);
    expect(cal.ece).toBeCloseTo(0, 6);
    expect(cal.meanPred).toBeCloseTo(cal.meanReal, 6);
  });

  it('detects a uniformly overconfident value head', () => {
    // predicts 0.9 everywhere, but reality is 0.5.
    const n = 100;
    const preds = new Array(n).fill(0.9);
    const real = new Array(n).fill(0.5);
    const cal = binCalibration(preds, real, 10);
    expect(cal.overconfidence).toBeCloseTo(0.4, 6); // +40 pts overconfident
    expect(cal.ece).toBeCloseTo(0.4, 6);
    // all mass in the [0.9,1.0) bin
    const top = cal.bins.find((b) => b.lo === 0.9)!;
    expect(top.n).toBe(n);
    expect(top.meanPred - top.meanReal).toBeCloseTo(0.4, 6);
  });

  it('handles pred exactly 1.0 (closed last bin) and empty bins', () => {
    const cal = binCalibration([1.0, 1.0], [1.0, 0.0], 10);
    expect(cal.n).toBe(2);
    const top = cal.bins.find((b) => b.lo === 0.9)!;
    expect(top.n).toBe(2); // both 1.0 land in the closed last bin
    expect(cal.meanReal).toBeCloseTo(0.5);
  });
});
