import { describe, expect, it } from 'vitest';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import {
  MAX_TOKENS,
  TOKEN_FEAT_DIM,
  TOKEN_TYPES,
  createEntityEncoder,
} from './entityEncode.js';

function advanceToCombat(start: RunState): RunState {
  let s = start;
  for (let i = 0; i < 500 && !s.combat; i++) {
    const legal = legalActions(content, s);
    if (legal.length === 0) break;
    s = applyAction(content, s, legal[0]!);
  }
  return s;
}

describe('createEntityEncoder', () => {
  const enc = createEntityEncoder(content);

  it('emits context + player tokens out of combat', () => {
    const tokens = enc.encode(createRun(content, 'ent-1', DEFAULT_RUN_CONFIG));
    expect(tokens.map((t) => TOKEN_TYPES[t.type])).toEqual(['context', 'player']);
    for (const t of tokens) expect(t.feats.length).toBe(TOKEN_FEAT_DIM);
  });

  it('emits a card token per hand card and an enemy token per enemy in combat', () => {
    const s = advanceToCombat(createRun(content, 'ent-2', DEFAULT_RUN_CONFIG));
    expect(s.combat).not.toBeNull();
    const tokens = enc.encode(s);
    const cards = tokens.filter((t) => TOKEN_TYPES[t.type] === 'card');
    const enemies = tokens.filter((t) => TOKEN_TYPES[t.type] === 'enemy');
    expect(cards.length).toBe(Math.min(s.combat!.hand.length, 10));
    expect(enemies.length).toBe(Math.min(s.combat!.enemies.length, 4));
    expect(tokens.length).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it('gives card/enemy tokens a valid vocab id; context/player id = -1', () => {
    const s = advanceToCombat(createRun(content, 'ent-3', DEFAULT_RUN_CONFIG));
    for (const t of enc.encode(s)) {
      const kind = TOKEN_TYPES[t.type];
      if (kind === 'card' || kind === 'enemy') expect(t.id).toBeGreaterThanOrEqual(0);
      else expect(t.id).toBe(-1);
    }
  });
});
