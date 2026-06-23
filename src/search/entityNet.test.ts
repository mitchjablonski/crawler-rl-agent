import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import type { Token } from './entityEncode.js';
import {
  type EntityNetConfig,
  type EntityNetParams,
  type EntitySample,
  createEntityNet,
  predictEntity,
  trainStepEntity,
} from './entityNet.js';

const rng = new Rng(seedFromString('entitynet'));
const rand = (): number => rng.next();

const cfg: EntityNetConfig = {
  numTokenTypes: 4,
  idVocab: 3,
  featDim: 4,
  actionSize: 6,
  dModel: 4,
  hidden: 5,
};

function makeTokens(): Token[] {
  const mk = (type: number, id: number): Token => ({
    type,
    id,
    feats: Float32Array.from({ length: cfg.featDim }, () => rand() * 2 - 1),
  });
  return [mk(0, -1), mk(1, -1), mk(2, 0), mk(2, 1), mk(3, 2)];
}

function clone(net: EntityNetParams): EntityNetParams {
  return JSON.parse(JSON.stringify(net)) as EntityNetParams;
}

/** Masked policy CE + value MSE — identical to trainStepEntity's loss. */
function lossOf(net: EntityNetParams, s: EntitySample): number {
  const { policy, value } = predictEntity(net, s.tokens);
  let max = -Infinity;
  for (let i = 0; i < cfg.actionSize; i++)
    if ((s.mask[i] ?? 0) > 0 && (policy[i] ?? 0) > max) max = policy[i] ?? 0;
  const p = new Float64Array(cfg.actionSize);
  let zs = 0;
  for (let i = 0; i < cfg.actionSize; i++)
    if ((s.mask[i] ?? 0) > 0) {
      const e = Math.exp((policy[i] ?? 0) - max);
      p[i] = e;
      zs += e;
    }
  let pl = 0;
  for (let i = 0; i < cfg.actionSize; i++) {
    const pp = zs > 0 ? (p[i] ?? 0) / zs : 0;
    const t = s.pi[i] ?? 0;
    if (t > 0) pl += -t * Math.log(pp || 1e-12);
  }
  return pl + (value - s.z) ** 2;
}

const WEIGHT_KEYS = [
  'typeEmb',
  'idEmb',
  'wFeat',
  'bFeat',
  'query',
  'wV',
  'wH',
  'bH',
  'wPolicy',
  'bPolicy',
  'wValue',
] as const;

describe('entityNet', () => {
  it('value is in [0,1] and policy has the right width', () => {
    const net = createEntityNet(cfg, rand);
    const out = predictEntity(net, makeTokens());
    expect(out.policy.length).toBe(cfg.actionSize);
    expect(out.value).toBeGreaterThanOrEqual(0);
    expect(out.value).toBeLessThanOrEqual(1);
  });

  it('analytic gradients match finite differences (every parameter group)', () => {
    const net = createEntityNet(cfg, rand);
    const mask = Float32Array.from([1, 1, 1, 0, 1, 0]);
    const pi = new Float32Array(cfg.actionSize);
    pi[0] = 0.6;
    pi[2] = 0.4;
    const sample: EntitySample = { tokens: makeTokens(), pi, mask, z: 0.7 };

    // Recover analytic grads from the weight delta of one step (lr known, l2=0).
    const lr = 1.0;
    const before = clone(net);
    trainStepEntity(net, [sample], lr, 0);

    const eps = 1e-4;
    const rel = (a: number, b: number): number =>
      Math.abs(a - b) / Math.max(1e-6, Math.abs(a) + Math.abs(b));

    for (const key of WEIGHT_KEYS) {
      const after = net[key] as number[];
      const orig = before[key] as number[];
      const work = clone(before);
      const w = work[key] as number[];
      for (let t = 0; t < Math.min(5, w.length); t++) {
        const k = Math.floor(rand() * w.length);
        const analytic = ((orig[k] as number) - (after[k] as number)) / lr;
        const base = w[k] as number;
        w[k] = base + eps;
        const lp = lossOf(work, sample);
        w[k] = base - eps;
        const lm = lossOf(work, sample);
        w[k] = base;
        expect(rel(analytic, (lp - lm) / (2 * eps))).toBeLessThan(1e-2);
      }
    }

    // bValue (scalar)
    const analyticBV = (before.bValue - net.bValue) / lr;
    const work = clone(before);
    work.bValue = before.bValue + eps;
    const lp = lossOf(work, sample);
    work.bValue = before.bValue - eps;
    const lm = lossOf(work, sample);
    expect(rel(analyticBV, (lp - lm) / (2 * eps))).toBeLessThan(1e-2);
  });

  it('trainStepEntity reduces loss on a fixed sample', () => {
    const net = createEntityNet(cfg, rand);
    const mask = Float32Array.from([1, 1, 1, 1, 1, 1]);
    const pi = new Float32Array(cfg.actionSize);
    pi[3] = 1;
    const sample: EntitySample = { tokens: makeTokens(), pi, mask, z: 1 };
    const first = trainStepEntity(net, [sample], 0.1);
    let last = first;
    for (let i = 0; i < 200; i++) last = trainStepEntity(net, [sample], 0.1);
    expect(last.loss).toBeLessThan(first.loss);
  });
});
