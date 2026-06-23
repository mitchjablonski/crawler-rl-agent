import { describe, expect, it } from 'vitest';
import { applyAction, createRun } from './run.js';
import { DEFAULT_RUN_CONFIG, content } from './content/index.js';
import { EngineError } from './types.js';
import type { RunState } from './types.js';

const run = (seed: string) => createRun(content, seed, DEFAULT_RUN_CONFIG);

describe('createRun', () => {
  it('is deterministic per seed', () => {
    expect(run('alpha')).toEqual(run('alpha'));
    expect(run('alpha')).not.toEqual(run('beta'));
  });

  it('defaults enemyHpMult to 1 and scales enemy HP when set', () => {
    expect(run('alpha').enemyHpMult).toBe(1);
    const firstNode = (s: RunState) => s.map.nodes[s.currentNodeId]?.next[0] as string;

    const neutral = createRun(content, 'hpmult', DEFAULT_RUN_CONFIG);
    const scaled = createRun(content, 'hpmult', { ...DEFAULT_RUN_CONFIG, enemyHpMult: 2 });
    const n = applyAction(content, neutral, { type: 'chooseNode', nodeId: firstNode(neutral) });
    const s = applyAction(content, scaled, { type: 'chooseNode', nodeId: firstNode(scaled) });
    const nHp = n.combat?.enemies[0]?.maxHp ?? 0;
    const sHp = s.combat?.enemies[0]?.maxHp ?? 0;
    expect(sHp).toBe(Math.round(nHp * 2)); // same seed roll, scaled after
  });

  it('starts at the map start with the starter deck', () => {
    const state = run('alpha');
    expect(state.phase).toBe('map');
    expect(state.currentNodeId).toBe(state.map.startId);
    expect(state.deck).toHaveLength(DEFAULT_RUN_CONFIG.starterDeck.length);
    expect(state.hp).toBe(DEFAULT_RUN_CONFIG.maxHp);
  });
});

describe('applyAction', () => {
  it('chooseNode follows edges and rejects non-edges', () => {
    const state = run('alpha');
    const first = state.map.nodes[state.currentNodeId]?.next[0] as string;
    const moved = applyAction(content, state, { type: 'chooseNode', nodeId: first });
    expect(moved.currentNodeId).toBe(first);
    expect(moved.phase).toBe('combat'); // row 1 is always combat
    expect(() =>
      applyAction(content, state, { type: 'chooseNode', nodeId: state.map.bossId }),
    ).toThrow(EngineError);
  });

  it('enforces phase guards', () => {
    const state = run('alpha');
    expect(() => applyAction(content, state, { type: 'endTurn' })).toThrow(EngineError);
    expect(() => applyAction(content, state, { type: 'rest' })).toThrow(EngineError);
  });

  it('rest heals 30% of max HP, capped', () => {
    const state: RunState = { ...run('alpha'), phase: 'rest', hp: 10 };
    const rested = applyAction(content, state, { type: 'rest' });
    expect(rested.hp).toBe(10 + Math.floor(70 * 0.2));
    expect(rested.phase).toBe('map');
  });

  it('reward pick adds the card and returns to the map', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'reward',
      reward: { cards: ['lucky-dagger'], gold: 0 },
    };
    const picked = applyAction(content, state, { type: 'pickRewardCard', index: 0 });
    expect(picked.deck).toContain('lucky-dagger');
    expect(picked.phase).toBe('map');
    expect(picked.reward).toBeNull();
  });

  it('buyCard spends gold and marks the slot sold', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'shop',
      gold: 100,
      shop: { stock: [{ cardId: 'shield-wall', price: 50, sold: false }] },
    };
    const bought = applyAction(content, state, { type: 'buyCard', index: 0 });
    expect(bought.gold).toBe(50);
    expect(bought.deck).toContain('shield-wall');
    expect(bought.shop?.stock[0]?.sold).toBe(true);
    expect(() => applyAction(content, bought, { type: 'buyCard', index: 0 })).toThrow(
      EngineError,
    );
  });

  it('event outcomes apply, and lethal ones end the run', () => {
    const base = run('alpha');
    const shrine: RunState = {
      ...base,
      phase: 'event',
      event: { eventId: 'shrine-of-the-crawl' },
    };
    const prayed = applyAction(content, shrine, { type: 'chooseEventOption', index: 0 });
    expect(prayed.maxHp).toBe(base.maxHp + 6);
    expect(prayed.hp).toBe(base.hp + 6);
    expect(prayed.phase).toBe('map');

    const dying: RunState = { ...shrine, hp: 3 };
    const looted = applyAction(content, dying, { type: 'chooseEventOption', index: 1 });
    expect(looted.phase).toBe('defeat');
  });
});
