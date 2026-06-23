import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import {
  DEFAULT_HIDDEN,
  type NetConfig,
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
});
