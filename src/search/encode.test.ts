import { describe, expect, it } from 'vitest';
import { applyAction, createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { GameAction, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import { createEncoder } from './encode.js';

function advanceToCombat(start: RunState): RunState {
  let s = start;
  for (let i = 0; i < 500 && !s.combat; i++) {
    const legal = legalActions(content, s);
    if (legal.length === 0) break;
    s = applyAction(content, s, legal[0] as GameAction);
  }
  return s;
}

describe('createEncoder', () => {
  const enc = createEncoder(content);

  it('produces a fixed-size vector matching its layout', () => {
    const v = enc.encode(createRun(content, 'enc-1', DEFAULT_RUN_CONFIG));
    expect(v.length).toBe(enc.size);
    let end = 0;
    for (const [o, l] of Object.values(enc.layout)) end = Math.max(end, o + l);
    expect(end).toBe(enc.size);
  });

  it('is deterministic for the same state', () => {
    const s = createRun(content, 'enc-2', DEFAULT_RUN_CONFIG);
    expect(Array.from(enc.encode(s))).toEqual(Array.from(enc.encode(s)));
  });

  it('encodes the deck as a count vector summing to deck size', () => {
    const s = createRun(content, 'enc-3', DEFAULT_RUN_CONFIG);
    const v = enc.encode(s);
    const [off, len] = enc.layout.deck;
    let sum = 0;
    for (let i = 0; i < len; i++) sum += v[off + i] ?? 0;
    expect(sum).toBe(s.deck.length);
  });

  it('marks exactly one phase one-hot bit', () => {
    const v = enc.encode(createRun(content, 'enc-4', DEFAULT_RUN_CONFIG));
    const [off, len] = enc.layout.phase;
    let ones = 0;
    for (let i = 0; i < len; i++) ones += v[off + i] ?? 0;
    expect(ones).toBe(1);
  });

  it('populates hand counts and an alive enemy slot in combat', () => {
    const s = advanceToCombat(createRun(content, 'enc-5', DEFAULT_RUN_CONFIG));
    expect(s.combat).not.toBeNull();
    const v = enc.encode(s);
    const [hOff, hLen] = enc.layout.hand;
    let handSum = 0;
    for (let i = 0; i < hLen; i++) handSum += v[hOff + i] ?? 0;
    expect(handSum).toBe(s.combat!.hand.length);
    expect(v[enc.layout.enemySlots[0]]).toBe(1);
  });

  it('encodes the hand positionally, aligned to hand index', () => {
    let s = createRun(content, 'enc-6', DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 500 && !s.combat; i++) {
      const legal = legalActions(content, s);
      if (legal.length === 0) break;
      s = applyAction(content, s, legal[0] as GameAction);
    }
    expect(s.combat).not.toBeNull();
    const v = enc.encode(s);
    const [hsBase] = enc.layout.handSlots;
    const C = enc.layout.deck[1]; // card-vocab width = length of the deck count field
    // Position 0 one-hots the actual card at hand[0], with the present flag set.
    const cardId0 = s.combat!.hand[0]!;
    const cardIds = Object.keys(content.cards).sort();
    const ci = cardIds.indexOf(cardId0);
    expect(v[hsBase + ci]).toBe(1);
    expect(v[hsBase + C]).toBe(1); // present flag
  });
});
