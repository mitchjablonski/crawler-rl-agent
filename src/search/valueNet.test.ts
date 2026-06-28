import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import {
  type ValueNetConfig,
  type ValueNetParams,
  type ValueSample,
  cloneValueNet,
  createValueNet,
  valueForward,
  valueTrainStep,
} from './valueNet.js';

const rand = (s: string): (() => number) => {
  const r = new Rng(seedFromString(s));
  return () => r.next();
};

describe('valueNet', () => {
  it('forward returns a value in [0,1] and is deterministic', () => {
    const net = createValueNet({ inputSize: 6, hidden: 5 }, rand('v'));
    const x = Float32Array.from({ length: 6 }, () => 0.3);
    const v = valueForward(net, x);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    expect(valueForward(net, x)).toBe(v);
  });

  it('learns to separate two targets (the shared-trunk head could not)', () => {
    const cfg: ValueNetConfig = { inputSize: 4, hidden: 8 };
    const net = createValueNet(cfg, rand('learn'));
    const lo = Float32Array.from([1, 0, 0, 0]);
    const hi = Float32Array.from([0, 0, 0, 1]);
    const batch: ValueSample[] = [
      { x: lo, target: 0.1 },
      { x: hi, target: 0.9 },
    ];
    for (let i = 0; i < 500; i++) valueTrainStep(net, batch, 0.5);
    expect(valueForward(net, lo)).toBeLessThan(0.3);
    expect(valueForward(net, hi)).toBeGreaterThan(0.7);
  });

  it('gradients match central finite differences (grad check)', () => {
    const cfg: ValueNetConfig = { inputSize: 5, hidden: 3 };
    const r = rand('grad');
    const net = createValueNet(cfg, r);
    const batch: ValueSample[] = Array.from({ length: 3 }, () => ({
      x: Float32Array.from({ length: cfg.inputSize }, () => r() * 2 - 1),
      target: r(),
    }));

    // Full-Float64 reimplementation of the mean MSE loss (independent of the gradient code path).
    const sig = (z: number): number => 1 / (1 + Math.exp(-z));
    const lossOf = (n: ValueNetParams): number => {
      let l = 0;
      for (const s of batch) {
        let pre = n.bOut;
        for (let j = 0; j < cfg.hidden; j++) {
          let sum = n.b1[j] ?? 0;
          const base = j * cfg.inputSize;
          for (let i = 0; i < cfg.inputSize; i++) sum += (n.w1[base + i] ?? 0) * (s.x[i] ?? 0);
          pre += (n.wOut[j] ?? 0) * (sum > 0 ? sum : 0);
        }
        const v = sig(pre);
        l += (v - s.target) * (v - s.target);
      }
      return l / batch.length;
    };

    const before = cloneValueNet(net);
    valueTrainStep(net, batch, 1, 0); // lr=1,l2=0 ⇒ (before − after) is the analytic gradient
    const after = net;
    const eps = 1e-4;
    for (const g of ['w1', 'b1', 'wOut'] as const) {
      const arr = before[g];
      for (let i = 0; i < arr.length; i++) {
        const analytic = (arr[i] ?? 0) - (after[g][i] ?? 0);
        const plus = cloneValueNet(before); plus[g][i] = (arr[i] ?? 0) + eps;
        const minus = cloneValueNet(before); minus[g][i] = (arr[i] ?? 0) - eps;
        const fd = (lossOf(plus) - lossOf(minus)) / (2 * eps);
        expect(Math.abs(analytic - fd)).toBeLessThan(1e-4 + 1e-3 * Math.abs(analytic));
      }
    }
    const analyticB = before.bOut - after.bOut;
    const plusB = cloneValueNet(before); plusB.bOut = before.bOut + eps;
    const minusB = cloneValueNet(before); minusB.bOut = before.bOut - eps;
    expect(Math.abs(analyticB - (lossOf(plusB) - lossOf(minusB)) / (2 * eps))).toBeLessThan(1e-4 + 1e-3 * Math.abs(analyticB));
  });
});
