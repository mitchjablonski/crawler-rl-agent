import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { greedyAction } from './heuristic.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

describe('greedy heuristic', () => {
  it('returns a legal action at every step of a full run', () => {
    const r = rand('h');
    let s: RunState = createRun(content, 'heur-1', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      const a = greedyAction(s, content, r);
      expect(() => applyAction(content, s, a)).not.toThrow();
      s = applyAction(content, s, a);
    }
    expect(['victory', 'defeat']).toContain(s.phase);
  });

  it('wins a clear majority of base-difficulty runs (sanity)', () => {
    let wins = 0;
    for (let i = 0; i < 12; i++) {
      const r = rand(`run-${i}`);
      let s: RunState = createRun(content, `heur-run-${i}`, DEFAULT_RUN_CONFIG);
      for (let k = 0; k < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; k++) {
        s = applyAction(content, s, greedyAction(s, content, r));
      }
      if (s.phase === 'victory') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(8); // greedy alone is strong at base
  });
});
