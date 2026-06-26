import { describe, expect, it } from 'vitest';
import { applyAction, createRun } from './run.js';
import { CHARACTERS, DEFAULT_RUN_CONFIG, content } from './content/index.js';
import { eventRequirementMet } from './types.js';
import type { GameAction, RunState } from './types.js';

const ACTION_CAP = 10_000;

type Policy = (state: RunState) => GameAction;

function greedy(state: RunState): GameAction {
  switch (state.phase) {
    case 'map': {
      const next = state.map.nodes[state.currentNodeId]?.next[0];
      if (!next) throw new Error('greedy bot: dead end');
      return { type: 'chooseNode', nodeId: next };
    }
    case 'combat': {
      const combat = state.combat;
      if (!combat) throw new Error('combat phase without combat state');
      const target = combat.enemies.findIndex((e) => e.hp > 0);
      for (let i = 0; i < combat.hand.length; i++) {
        const card = content.cards[combat.hand[i] as string];
        if (!card || card.cost > combat.energy) continue;
        return {
          type: 'playCard',
          handIndex: i,
          targetIndex: card.target === 'enemy' ? target : undefined,
        };
      }
      return { type: 'endTurn' };
    }
    case 'reward':
      return state.reward?.cards.length
        ? { type: 'pickRewardCard', index: 0 }
        : { type: 'skipReward' };
    case 'shop':
      return { type: 'leaveShop' };
    case 'rest':
      return { type: 'rest' };
    case 'event': {
      // A result screen is showing → continue back to the map.
      if (state.event?.result) return { type: 'continueEvent' };
      // Otherwise pick the first AVAILABLE option (respect stat gating).
      const def = state.event ? content.events[state.event.eventId] : undefined;
      const index = (def?.options ?? []).findIndex((o) => eventRequirementMet(state, o.requires));
      return { type: 'chooseEventOption', index: index < 0 ? 0 : index };
    }
    case 'victory':
    case 'defeat':
      throw new Error('run already over');
  }
}

function passive(state: RunState): GameAction {
  if (state.phase === 'combat') return { type: 'endTurn' };
  return greedy(state);
}

function runBot(seed: string, policy: Policy, acts = 1) {
  let state = createRun(content, seed, { ...DEFAULT_RUN_CONFIG, acts });
  const history: RunState[] = [state];
  for (let i = 0; i < ACTION_CAP; i++) {
    if (state.phase === 'victory' || state.phase === 'defeat') {
      return { outcome: state.phase, history };
    }
    state = applyAction(content, state, policy(state));
    history.push(state);
  }
  throw new Error(`bot did not finish within ${ACTION_CAP} actions (seed ${seed})`);
}

describe('headless full runs', () => {
  it('same seed + same policy = identical state histories', () => {
    const a = runBot('replay-me', greedy);
    const b = runBot('replay-me', greedy);
    expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history));
  });

  it('greedy bot finishes 50 seeded runs, hitting both outcomes', () => {
    const outcomes = { victory: 0, defeat: 0 };
    for (let i = 0; i < 50; i++) {
      const { outcome } = runBot(`greedy-${i}`, greedy);
      outcomes[outcome]++;
    }
    expect(outcomes.victory + outcomes.defeat).toBe(50);
    expect(outcomes.victory).toBeGreaterThan(0);
    expect(outcomes.defeat).toBeGreaterThan(0);
  });

  it('passive bot always loses', () => {
    for (let i = 0; i < 10; i++) {
      expect(runBot(`passive-${i}`, passive).outcome).toBe('defeat');
    }
  });

  it('greedy completes runs as the Apothecary class', () => {
    const apo = CHARACTERS['apothecary']!;
    const cfg = {
      ...DEFAULT_RUN_CONFIG,
      starterDeck: apo.starterDeck,
      startingRelics: apo.startingRelics,
      maxHp: apo.maxHp,
    };
    let finished = 0;
    for (let i = 0; i < 20; i++) {
      let state = createRun(content, `apo-${i}`, cfg);
      for (let j = 0; j < 10_000 && !['victory', 'defeat'].includes(state.phase); j++) {
        state = applyAction(content, state, greedy(state));
      }
      if (['victory', 'defeat'].includes(state.phase)) finished++;
    }
    expect(finished).toBe(20);
  });

  it('greedy completes 3-act arc runs and reaches both outcomes', () => {
    const outcomes = { victory: 0, defeat: 0 };
    for (let i = 0; i < 30; i++) {
      const { outcome } = runBot(`arc-${i}`, greedy, 3);
      outcomes[outcome]++;
    }
    expect(outcomes.victory + outcomes.defeat).toBe(30);
    expect(outcomes.victory).toBeGreaterThan(0);
    expect(outcomes.defeat).toBeGreaterThan(0);
  });
});
