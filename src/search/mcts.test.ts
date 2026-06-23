import { describe, expect, it } from 'vitest';
import { mctsAction, type RolloutPolicy } from './mcts.js';
import { legalActions } from './legalActions.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { GameAction, RunState } from '../engine/types.js';

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Greedy-ish rollout: first affordable attack, else first playable, else end turn.
const greedyRollout: RolloutPolicy = (c, state, rand) => {
  const actions = legalActions(c, state);
  if (state.phase === 'combat') {
    const attack = actions.find((a) => {
      if (a.type !== 'playCard') return false;
      const card = c.cards[state.combat!.hand[a.handIndex] as string];
      return card?.type === 'attack';
    });
    if (attack) return attack;
    const nonEnd = actions.find((a) => a.type === 'playCard');
    if (nonEnd) return nonEnd;
    return { type: 'endTurn' };
  }
  return actions[Math.floor(rand() * actions.length)] as GameAction;
};

const opts = (seed: number, iterations = 40) => ({
  iterations,
  rollout: greedyRollout,
  rand: mulberry(seed),
});

describe('mctsAction', () => {
  it('returns a legal action', () => {
    const state = createRun(content, 'mcts-a', DEFAULT_RUN_CONFIG);
    const action = mctsAction(content, state, opts(1));
    expect(legalActions(content, state)).toContainEqual(action);
  });

  it('is deterministic for a fixed seed', () => {
    const state = createRun(content, 'mcts-b', DEFAULT_RUN_CONFIG);
    expect(mctsAction(content, state, opts(7))).toEqual(mctsAction(content, state, opts(7)));
  });

  it('drives a full run to a terminal state', () => {
    let state = createRun(content, 'mcts-c', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 2000 && !['victory', 'defeat'].includes(state.phase); i++) {
      state = applyAction(content, state, mctsAction(content, state, opts(i + 1, 20)));
    }
    expect(['victory', 'defeat']).toContain(state.phase);
  });

  it('plays at least as well as its rollout policy over a small sample', () => {
    const runWith = (driver: (s: RunState, seed: number) => GameAction) => {
      let wins = 0;
      for (let r = 0; r < 8; r++) {
        let state = createRun(content, `cmp-${r}`, DEFAULT_RUN_CONFIG);
        for (let i = 0; i < 3000 && !['victory', 'defeat'].includes(state.phase); i++) {
          state = applyAction(content, state, driver(state, r * 1000 + i));
        }
        if (state.phase === 'victory') wins++;
      }
      return wins;
    };
    const mctsWins = runWith((s, seed) => mctsAction(content, s, opts(seed, 60)));
    const greedyWins = runWith((s, seed) => greedyRollout(content, s, mulberry(seed)));
    expect(mctsWins).toBeGreaterThanOrEqual(greedyWins);
  });
});
