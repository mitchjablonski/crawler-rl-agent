import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import { policyAction, policyWinRate } from './policy.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);
const net = createNet(
  { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
  rand('net'),
);

describe('no-search policy', () => {
  it('returns a legal, applicable action', () => {
    const s = createRun(content, 'pol-1', DEFAULT_RUN_CONFIG);
    expect(() => applyAction(content, s, policyAction(content, s, enc, net))).not.toThrow();
  });

  it('is deterministic (argmax, no rng)', () => {
    const s = createRun(content, 'pol-2', DEFAULT_RUN_CONFIG);
    expect(policyAction(content, s, enc, net)).toEqual(policyAction(content, s, enc, net));
  });

  it('drives a full episode to a terminal phase', () => {
    let s: RunState = createRun(content, 'pol-3', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(content, s, policyAction(content, s, enc, net));
    }
    expect(['victory', 'defeat']).toContain(s.phase);
  });

  it('policyWinRate returns a fraction in [0,1]', () => {
    const wr = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, ['eval-0', 'eval-1', 'eval-2']);
    expect(wr).toBeGreaterThanOrEqual(0);
    expect(wr).toBeLessThanOrEqual(1);
  });
});
