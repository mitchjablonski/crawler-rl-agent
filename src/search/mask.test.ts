import { describe, expect, it } from 'vitest';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { GameAction, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, actionMask, slotOf } from './mask.js';

function* states(seed: string, limit = 300): Generator<RunState> {
  let s = createRun(content, seed, DEFAULT_RUN_CONFIG);
  for (let i = 0; i < limit; i++) {
    yield s;
    const legal = legalActions(content, s);
    if (legal.length === 0) break;
    const play = legal.find((a) => a.type === 'playCard');
    s = applyAction(content, s, play ?? (legal[0] as GameAction));
  }
}

describe('actionMask', () => {
  it('mask ones + dropped equals the legal action count', () => {
    for (const s of states('mask-1')) {
      const legal = legalActions(content, s);
      const { mask, dropped } = actionMask(content, s);
      let ones = 0;
      for (const m of mask) ones += m;
      expect(ones + dropped.length).toBe(legal.length);
    }
  });

  it('decodes every set slot back to a legal action', () => {
    for (const s of states('mask-2')) {
      const legal = legalActions(content, s);
      const { mask, actions } = actionMask(content, s);
      for (let i = 0; i < ACTION_SPACE; i++) {
        if (mask[i] === 1) {
          expect(actions[i]).not.toBeNull();
          expect(legal).toContainEqual(actions[i]);
        } else {
          expect(actions[i]).toBeNull();
        }
      }
    }
  });

  it('assigns distinct slots to distinct legal actions', () => {
    for (const s of states('mask-3')) {
      const slots = legalActions(content, s)
        .map((a) => slotOf(s, a))
        .filter((x): x is number => x !== null);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  it('never assigns a slot at or beyond ACTION_SPACE', () => {
    for (const s of states('mask-4')) {
      for (const a of legalActions(content, s)) {
        const slot = slotOf(s, a);
        if (slot !== null) expect(slot).toBeLessThan(ACTION_SPACE);
      }
    }
  });
});
