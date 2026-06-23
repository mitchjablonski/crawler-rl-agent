import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE } from './mask.js';
import { buildQTargets, qDeterminized, reseed } from './determinized.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

function toCombat(seed: string): RunState {
  let s = createRun(content, seed, DEFAULT_RUN_CONFIG);
  for (let i = 0; i < 500 && !s.combat; i++) {
    const legal = legalActions(content, s);
    if (legal.length === 0) break;
    s = applyAction(content, s, legal[0]!);
  }
  return s;
}

describe('determinized', () => {
  it('reseed changes the RNG streams but keeps materialized state', () => {
    const s = toCombat('det-1');
    const r = reseed(s, rand('a'));
    expect(r.rng).not.toEqual(s.rng);
    expect(r.hp).toBe(s.hp);
    expect(r.combat?.hand).toEqual(s.combat?.hand); // hand already drawn, unchanged
  });

  it('qDeterminized returns a probability and is deterministic for a seed', () => {
    const s = toCombat('det-2');
    const a = legalActions(content, s)[0]!;
    const q1 = qDeterminized(content, s, a, 6, rand('q'));
    const q2 = qDeterminized(content, s, a, 6, rand('q'));
    expect(q1).toBe(q2);
    expect(q1).toBeGreaterThanOrEqual(0);
    expect(q1).toBeLessThanOrEqual(1);
  });

  it('buildQTargets yields a distribution over legal actions and value in [0,1]', () => {
    const s = toCombat('det-3');
    const { mask, pi, value } = buildQTargets(content, s, 6, rand('t'));
    let sum = 0;
    for (let i = 0; i < ACTION_SPACE; i++) {
      if ((pi[i] ?? 0) > 0) expect(mask[i]).toBe(1);
      sum += pi[i] ?? 0;
    }
    expect(sum).toBeCloseTo(1, 5);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});
