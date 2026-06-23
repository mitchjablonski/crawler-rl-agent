import { describe, expect, it } from 'vitest';
import { legalActions } from './legalActions.js';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';

const fresh = () => createRun(content, 'legal-test', DEFAULT_RUN_CONFIG);

describe('legalActions', () => {
  it('map phase offers exactly the reachable next nodes', () => {
    const state = fresh();
    const actions = legalActions(content, state);
    const expected = state.map.nodes[state.currentNodeId]?.next ?? [];
    expect(actions).toHaveLength(expected.length);
    expect(actions.every((a) => a.type === 'chooseNode')).toBe(true);
  });

  it('every enumerated action is accepted by applyAction (no throws)', () => {
    const visited = new Set<string>();
    let state = fresh();
    for (let i = 0; i < 200 && !['victory', 'defeat'].includes(state.phase); i++) {
      const actions = legalActions(content, state);
      expect(actions.length).toBeGreaterThan(0);
      visited.add(state.phase);
      for (const action of actions) {
        expect(() => applyAction(content, state, action)).not.toThrow();
      }
      state = applyAction(content, state, actions[0]!);
    }
    expect(visited.has('combat')).toBe(true);
  });

  it('combat lists affordable cards plus endTurn', () => {
    let state = fresh();
    const first = state.map.nodes[state.currentNodeId]?.next[0] as string;
    state = applyAction(content, state, { type: 'chooseNode', nodeId: first });
    expect(state.phase).toBe('combat');
    const actions = legalActions(content, state);
    expect(actions.some((a) => a.type === 'endTurn')).toBe(true);
    expect(actions.some((a) => a.type === 'playCard')).toBe(true);
  });

  it('returns nothing in terminal phases', () => {
    const dead: RunState = { ...fresh(), phase: 'defeat' };
    expect(legalActions(content, dead)).toHaveLength(0);
  });
});
