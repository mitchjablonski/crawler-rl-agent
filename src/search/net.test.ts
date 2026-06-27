import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import {
  DEFAULT_HIDDEN,
  type NetConfig,
  type NetParams,
  type TrainSample,
  createNet,
  forward,
  policyPriors,
  trainStep,
} from './net.js';

function seededRand(seed: string): () => number {
  const rng = new Rng(seedFromString(seed));
  return () => rng.next();
}

const config: NetConfig = { inputSize: 201, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN };

describe('net', () => {
  it('createNet is deterministic for the same seed', () => {
    const a = createNet(config, seededRand('s'));
    const b = createNet(config, seededRand('s'));
    expect(a.w1).toEqual(b.w1);
    expect(a.wPolicy).toEqual(b.wPolicy);
    expect(a.wValue).toEqual(b.wValue);
  });

  it('forward produces the right shapes and a value in [0,1]', () => {
    const net = createNet(config, seededRand('s'));
    const x = new Float32Array(config.inputSize).fill(0.1);
    const out = forward(net, x);
    expect(out.policy.length).toBe(ACTION_SPACE);
    expect(out.value).toBeGreaterThanOrEqual(0);
    expect(out.value).toBeLessThanOrEqual(1);
  });

  it('forward is deterministic', () => {
    const net = createNet(config, seededRand('s'));
    const x = new Float32Array(config.inputSize).fill(0.3);
    expect(Array.from(forward(net, x).policy)).toEqual(Array.from(forward(net, x).policy));
  });

  it('policyPriors is a distribution over legal actions only', () => {
    const enc = createEncoder(content);
    const net = createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
      seededRand('s'),
    );
    const state = createRun(content, 'net-1', DEFAULT_RUN_CONFIG);
    const { mask } = actionMask(content, state);
    const priors = policyPriors(forward(net, enc.encode(state)).policy, mask);

    let sum = 0;
    for (let i = 0; i < ACTION_SPACE; i++) {
      if ((mask[i] ?? 0) === 0) expect(priors[i]).toBe(0); // illegal => 0
      sum += priors[i] ?? 0;
    }
    expect(sum).toBeCloseTo(1, 5);
  });

  it('policyPriors returns all-zeros when nothing is legal', () => {
    const logits = new Float32Array(ACTION_SPACE).fill(1);
    const mask = new Float32Array(ACTION_SPACE); // all illegal
    const priors = policyPriors(logits, mask);
    let sum = 0;
    for (const p of priors) sum += p;
    expect(sum).toBe(0);
  });

  it('trainStep drives loss down and concentrates policy + value on the target', () => {
    const cfg: NetConfig = { inputSize: 16, actionSize: ACTION_SPACE, hidden: 32 };
    const net = createNet(cfg, seededRand('train'));
    const x = new Float32Array(cfg.inputSize).fill(0.5);
    const mask = new Float32Array(ACTION_SPACE);
    for (let i = 0; i < 5; i++) mask[i] = 1; // first 5 slots legal
    const pi = new Float32Array(ACTION_SPACE);
    pi[2] = 1; // target slot 2
    const sample: TrainSample = { x, pi, mask, z: 1 };

    const first = trainStep(net, [sample], 0.5);
    let last = first;
    for (let i = 0; i < 400; i++) last = trainStep(net, [sample], 0.5);

    expect(last.loss).toBeLessThan(first.loss);
    const priors = policyPriors(forward(net, x).policy, mask);
    expect(priors[2]).toBeGreaterThan(0.8); // learned the target action
    expect(forward(net, x).value).toBeGreaterThan(0.8); // learned z = 1
  });

  it('trainStep gradients match central finite differences (grad check)', () => {
    const cfg: NetConfig = { inputSize: 5, actionSize: 4, hidden: 3 };
    const rand = seededRand('gradcheck');
    const net = createNet(cfg, rand);

    // Small batch: legal masks + a normalized policy target over legal slots + value targets.
    const batch: TrainSample[] = Array.from({ length: 3 }, (_, b) => {
      const x = Float32Array.from({ length: cfg.inputSize }, () => rand() * 2 - 1);
      const mask = new Float32Array(cfg.actionSize);
      mask[0] = 1; mask[1] = 1; mask[(b % 2) + 2] = 1; // 3 legal slots, varied per sample
      const w: number[] = [];
      let tot = 0;
      for (let a = 0; a < cfg.actionSize; a++) { const v = mask[a] ? rand() + 0.1 : 0; w[a] = v; tot += v; }
      const pi = new Float32Array(cfg.actionSize);
      for (let a = 0; a < cfg.actionSize; a++) pi[a] = (w[a] ?? 0) / tot;
      return { x, pi, mask, z: rand() };
    });

    const clone = (n: NetParams): NetParams => ({
      config: n.config, w1: [...n.w1], b1: [...n.b1], wPolicy: [...n.wPolicy],
      bPolicy: [...n.bPolicy], wValue: [...n.wValue], bValue: n.bValue,
    });
    // Mean loss = masked-softmax CE(π) + value MSE(z), exactly what trainStep minimizes. Computed
    // in full Float64 here (not via forward(), which downcasts hidden activations to Float32 and
    // would inject ~1e-7 noise that the central difference amplifies past tolerance).
    const { inputSize, actionSize, hidden } = cfg;
    const lossOf = (n: NetParams): number => {
      let pl = 0;
      let vl = 0;
      for (const s of batch) {
        const h: number[] = [];
        for (let j = 0; j < hidden; j++) {
          let sum = n.b1[j] ?? 0;
          const base = j * inputSize;
          for (let i = 0; i < inputSize; i++) sum += (n.w1[base + i] ?? 0) * (s.x[i] ?? 0);
          h[j] = sum > 0 ? sum : 0;
        }
        const logits: number[] = [];
        for (let a = 0; a < actionSize; a++) {
          let sum = n.bPolicy[a] ?? 0;
          const base = a * hidden;
          for (let j = 0; j < hidden; j++) sum += (n.wPolicy[base + j] ?? 0) * (h[j] ?? 0);
          logits[a] = sum;
        }
        let max = -Infinity;
        for (let a = 0; a < actionSize; a++) if ((s.mask[a] ?? 0) > 0 && (logits[a] ?? 0) > max) max = logits[a] ?? 0;
        const p: number[] = new Array<number>(actionSize).fill(0);
        if (max > -Infinity) {
          let zs = 0;
          for (let a = 0; a < actionSize; a++) if ((s.mask[a] ?? 0) > 0) { const e = Math.exp((logits[a] ?? 0) - max); p[a] = e; zs += e; }
          if (zs > 0) for (let a = 0; a < actionSize; a++) p[a] = (p[a] ?? 0) / zs;
        }
        for (let a = 0; a < actionSize; a++) { const t = s.pi[a] ?? 0; if (t > 0) pl += -t * Math.log((p[a] ?? 0) || 1e-12); }
        let vPre = n.bValue;
        for (let j = 0; j < hidden; j++) vPre += (n.wValue[j] ?? 0) * (h[j] ?? 0);
        const v = 1 / (1 + Math.exp(-vPre));
        vl += (v - s.z) ** 2;
      }
      return (pl + vl) / batch.length;
    };

    // With lr=1, l2=0 the in-place update is `after = before − ∂L/∂θ`, so (before − after) is the
    // analytic gradient of the mean loss — compare it to central finite differences of lossOf.
    const before = clone(net);
    trainStep(net, batch, 1, 0);
    const after = net;
    const eps = 1e-4;

    for (const g of ['w1', 'b1', 'wPolicy', 'bPolicy', 'wValue'] as const) {
      const arr = before[g];
      for (let i = 0; i < arr.length; i++) {
        const analytic = (arr[i] ?? 0) - (after[g][i] ?? 0);
        const plus = clone(before); plus[g][i] = (arr[i] ?? 0) + eps;
        const minus = clone(before); minus[g][i] = (arr[i] ?? 0) - eps;
        const fd = (lossOf(plus) - lossOf(minus)) / (2 * eps);
        expect(Math.abs(analytic - fd)).toBeLessThan(1e-4 + 1e-3 * Math.abs(analytic));
      }
    }
    // bValue (scalar)
    const analyticBV = before.bValue - after.bValue;
    const plusBV = clone(before); (plusBV as { bValue: number }).bValue = before.bValue + eps;
    const minusBV = clone(before); (minusBV as { bValue: number }).bValue = before.bValue - eps;
    const fdBV = (lossOf(plusBV) - lossOf(minusBV)) / (2 * eps);
    expect(Math.abs(analyticBV - fdBV)).toBeLessThan(1e-4 + 1e-3 * Math.abs(analyticBV));
  });
});
