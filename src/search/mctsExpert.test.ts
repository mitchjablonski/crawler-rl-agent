import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { mctsExpertSearch } from './mctsExpert.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

describe('mctsExpertSearch', () => {
  it('returns visits on legal slots only, a legal action, and rootValue in [0,1]', () => {
    const state = createRun(content, 'mx-1', DEFAULT_RUN_CONFIG);
    const { mask, actions } = actionMask(content, state);
    const res = mctsExpertSearch(content, state, { iterations: 64, rand: rand('a') });

    let visitSum = 0;
    for (let i = 0; i < ACTION_SPACE; i++) {
      if ((res.visits[i] ?? 0) > 0) expect(mask[i]).toBe(1);
      visitSum += res.visits[i] ?? 0;
    }
    expect(visitSum).toBeGreaterThan(0);
    expect(res.rootValue).toBeGreaterThanOrEqual(0);
    expect(res.rootValue).toBeLessThanOrEqual(1);
    // the chosen action is one of the legal actions
    expect(actions.filter(Boolean)).toContainEqual(res.action);
  });

  it('is deterministic for the same seed', () => {
    const state = createRun(content, 'mx-2', DEFAULT_RUN_CONFIG);
    const a = mctsExpertSearch(content, state, { iterations: 48, rand: rand('s') });
    const b = mctsExpertSearch(content, state, { iterations: 48, rand: rand('s') });
    expect(Array.from(a.visits)).toEqual(Array.from(b.visits));
    expect(a.rootValue).toBe(b.rootValue);
    expect(a.action).toEqual(b.action);
  });
});
