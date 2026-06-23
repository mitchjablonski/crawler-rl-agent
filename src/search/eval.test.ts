import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import type { SelfPlayOptions } from './train.js';
import { imitationAgreement } from './eval.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);

describe('imitationAgreement', () => {
  it('returns a fraction in [0,1] over many decision states', () => {
    const net = createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
      rand('net'),
    );
    const teacher: SelfPlayOptions = {
      content,
      encoder: enc,
      net,
      config: DEFAULT_RUN_CONFIG,
      searchIterations: 8,
      rand: rand('search'),
    };
    const res = imitationAgreement(content, enc, net, teacher, ['eval-0', 'eval-1']);
    expect(res.states).toBeGreaterThan(0);
    expect(res.agreement).toBeGreaterThanOrEqual(0);
    expect(res.agreement).toBeLessThanOrEqual(1);
  });

  it('is deterministic for the same nets and seeds', () => {
    const net = createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
      rand('net'),
    );
    const teacher = (): SelfPlayOptions => ({
      content,
      encoder: enc,
      net,
      config: DEFAULT_RUN_CONFIG,
      searchIterations: 16,
      rand: rand('search'),
    });
    const seeds = ['eval-0', 'eval-1', 'eval-2'];
    const a = imitationAgreement(content, enc, net, teacher(), seeds);
    const b = imitationAgreement(content, enc, net, teacher(), seeds);
    expect(a).toEqual(b);
  });
});
