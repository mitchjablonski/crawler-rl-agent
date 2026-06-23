import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import { type PuctOptions, puctAction, puctSearch } from './puct.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);
const net = createNet(
  { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
  rand('net'),
);
const opts = (seed: string, iterations = 24): PuctOptions => ({
  encoder: enc,
  net,
  iterations,
  rand: rand(seed),
});

describe('puct', () => {
  it('returns a legal, applicable action', () => {
    const s = createRun(content, 'p1', DEFAULT_RUN_CONFIG);
    const a = puctAction(content, s, opts('a'));
    expect(() => applyAction(content, s, a)).not.toThrow();
  });

  it('visits are nonzero only on legal slots and sum within the iteration budget', () => {
    const s = createRun(content, 'p2', DEFAULT_RUN_CONFIG);
    const { mask } = actionMask(content, s);
    const { visits } = puctSearch(content, s, opts('b', 24));
    let sum = 0;
    for (let i = 0; i < ACTION_SPACE; i++) {
      if ((visits[i] ?? 0) > 0) expect(mask[i]).toBe(1);
      sum += visits[i] ?? 0;
    }
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(24);
  });

  it('drives a full episode to a terminal phase', () => {
    let s: RunState = createRun(content, 'p3', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 3000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(content, s, puctAction(content, s, opts(`e${i}`, 16)));
    }
    expect(['victory', 'defeat']).toContain(s.phase);
  });

  it('is deterministic for the same seed and net', () => {
    const s = createRun(content, 'p4', DEFAULT_RUN_CONFIG);
    expect(puctAction(content, s, opts('z'))).toEqual(puctAction(content, s, opts('z')));
  });
});
