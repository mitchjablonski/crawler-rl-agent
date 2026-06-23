import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import { azSearch } from './azsearch.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content, undefined, { positionalHand: false });
const net = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN }, rand('net'));

describe('azSearch (net-guided determinized PUCT)', () => {
  it('returns a legal action with visits on legal slots and rootValue in [0,1]', () => {
    const s = createRun(content, 'az-1', DEFAULT_RUN_CONFIG);
    const { mask, actions } = actionMask(content, s);
    const res = azSearch(content, s, { iterations: 48, rand: rand('a'), net, encoder: enc });
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
    let s: RunState = createRun(content, 'az-2', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 3000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(content, s, azSearch(content, s, { iterations: 24, rand: rand(`e${i}`), net, encoder: enc }).action);
    }
    expect(['victory', 'defeat']).toContain(s.phase);
  });
});
