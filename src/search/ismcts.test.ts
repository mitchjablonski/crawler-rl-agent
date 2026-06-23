import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { ismctsSearch } from './ismcts.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

describe('ismctsSearch', () => {
  it('returns a legal action, visits on legal slots, rootValue in [0,1]', () => {
    const s = createRun(content, 'is-1', DEFAULT_RUN_CONFIG);
    const { mask, actions } = actionMask(content, s);
    const res = ismctsSearch(content, s, { iterations: 64, rand: rand('a') });
    let sum = 0;
    for (let i = 0; i < ACTION_SPACE; i++) {
      if ((res.visits[i] ?? 0) > 0) expect(mask[i]).toBe(1);
      sum += res.visits[i] ?? 0;
    }
    expect(sum).toBeGreaterThan(0);
    expect(res.rootValue).toBeGreaterThanOrEqual(0);
    expect(res.rootValue).toBeLessThanOrEqual(1);
    expect(actions.filter(Boolean)).toContainEqual(res.action);
  });

  it('drives a full episode to a terminal phase', () => {
    let s: RunState = createRun(content, 'is-2', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 3000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(content, s, ismctsSearch(content, s, { iterations: 24, rand: rand(`e${i}`) }).action);
    }
    expect(['victory', 'defeat']).toContain(s.phase);
  });
});
