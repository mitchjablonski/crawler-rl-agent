import { describe, expect, it } from 'vitest';
import { scoreCard } from './scoreCard.js';
import { cards } from '../../src/engine/content/cards.js';
import type { CardDef } from '../../src/engine/types.js';

// Tooling-only unit tests for the #39 draft scorer. The scorer is a pure,
// deterministic estimate of a card's draft strength used by the playtest
// harness so greedy stops picking reward cards blind. These tests pin the
// properties the harness relies on: rarity dominance, value/efficiency, and
// determinism — NOT exact magnitudes (those are free to be tuned).
describe('scoreCard', () => {
  it('is deterministic (same input -> same score)', () => {
    const c = cards['goblin-stomp'] as CardDef;
    expect(scoreCard(c)).toBe(scoreCard(c));
    const ctx = { deck: ['rusty-shortsword', 'battered-buckler'], cards };
    expect(scoreCard(c, ctx)).toBe(scoreCard(c, ctx));
  });

  it('scores a rare above a common of equal cost', () => {
    // Build a rare and a common with identical effects + cost so ONLY rarity
    // differs — the rarity weight must break the tie upward.
    const common: CardDef = {
      id: 't-common',
      name: 'T Common',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 2,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
    };
    const rare: CardDef = { ...common, id: 't-rare', rarity: 'rare' };
    expect(scoreCard(rare)).toBeGreaterThan(scoreCard(common));
  });

  it('scores a high-value efficient card above a dead-weight one', () => {
    // guillotine: 24 dmg / 3 cost, rare — strong. A "dead" card: tiny effect at
    // the same rarity/cost must score far lower.
    const guillotine = cards['guillotine'] as CardDef;
    const dead: CardDef = {
      id: 't-dead',
      name: 'Dead Weight',
      description: '',
      type: 'attack',
      rarity: 'rare',
      cost: 3,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 2, target: 'enemy' }],
    };
    expect(scoreCard(guillotine)).toBeGreaterThan(scoreCard(dead));
  });

  it('rewards cost efficiency: same value at lower cost scores higher', () => {
    const cheap: CardDef = {
      id: 't-cheap',
      name: 'Cheap',
      description: '',
      type: 'skill',
      rarity: 'common',
      cost: 1,
      target: 'self',
      effects: [{ kind: 'block', amount: 8 }],
    };
    const pricey: CardDef = { ...cheap, id: 't-pricey', cost: 3 };
    expect(scoreCard(cheap)).toBeGreaterThan(scoreCard(pricey));
  });

  it('values a 0-cost card as a free-play premium (#48)', () => {
    // A 0-cost card is a free play: worth strictly MORE per raw point than the
    // old `max(0.7, cost)` divisor gave, AND more than a comparable 1-cost card
    // of equal raw value/rarity/type. throwing-knife (0-cost, 4 dmg, common) is
    // the regression case the greedy sweep under-valued (pickRate ~0 pre-fix).
    const knife = cards['throwing-knife'] as CardDef;
    // Same raw value/rarity/type but 1 cost: the 0-cost card must beat it.
    const oneCost: CardDef = { ...knife, id: 't-1cost', cost: 1 };
    expect(scoreCard(knife)).toBeGreaterThan(scoreCard(oneCost));

    // ...and above what the OLD divisor (max(0.7, cost) === 0.7) would have
    // produced for the same card — i.e. the free-play premium is a real lift.
    const rawValue = 4; // 4 damage * DAMAGE_VALUE(1.0)
    const oldScore = (rawValue / 0.7) * 1.0; // old divisor * common rarity
    expect(scoreCard(knife)).toBeGreaterThan(oldScore);
  });

  it('gates the 0-cost premium to cost===0 only (#48)', () => {
    // A 1-cost card must be scored by the unchanged `max(0.7, cost)` path — the
    // free-play premium must NOT leak onto non-zero-cost cards.
    const oneCost: CardDef = {
      id: 't-1cost-gate',
      name: 'One Cost',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 1,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 4, target: 'enemy' }],
    };
    const rawValue = 4;
    const expected = (rawValue / 1) * 1.0; // divisor === cost === 1, common
    expect(scoreCard(oneCost)).toBe(expected);
  });

  it('is deterministic for a 0-cost card (#48)', () => {
    const knife = cards['throwing-knife'] as CardDef;
    expect(scoreCard(knife)).toBe(scoreCard(knife));
  });

  it('values regen above its old one-shot (1.4-weight) score (#53)', () => {
    // regen compounds over the fight (heals N HP every turn), so the scorer now
    // weights it 2.1/stack rather than the old 1.4. A regen card must therefore
    // score ABOVE what the old weight produced. iron-hide (regen 3, 1-cost,
    // uncommon) was the greedy under-valuation case (pickRate ~0 pre-fix).
    const ironHide = cards['iron-hide'] as CardDef;
    // Old score = (3 stacks * 1.4) / max(0.7,1) * RARITY uncommon(1.35).
    const oldScore = ((3 * 1.4) / 1) * 1.35;
    expect(scoreCard(ironHide)).toBeGreaterThan(oldScore);
    // New score = (3 * 2.1) / 1 * 1.35 — pin the exact compounding value.
    expect(scoreCard(ironHide)).toBeCloseTo(((3 * 2.1) / 1) * 1.35, 10);
  });

  it('lands regen in a sensible band vs peers (#53)', () => {
    // The lift must not over-reach: iron-hide (regen 3) should out-value a weak
    // common attack of the same cost, yet stay BELOW a strong rare bomb so the
    // boost doesn't make sustain dominate the draft.
    const ironHide = cards['iron-hide'] as CardDef;
    const weakCommon: CardDef = {
      id: 't-weak-common',
      name: 'Weak Common',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 1,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 3, target: 'enemy' }],
    };
    expect(scoreCard(ironHide)).toBeGreaterThan(scoreCard(weakCommon));
    const guillotine = cards['guillotine'] as CardDef; // 24 dmg/3, rare bomb
    expect(scoreCard(ironHide)).toBeLessThan(scoreCard(guillotine));
  });

  it('keeps the regen change gated to regen — non-regen cards unchanged (#53)', () => {
    // A block card of equal raw stacks/cost/rarity to a regen card must be
    // scored by the unchanged BLOCK_VALUE path: the regen lift is status-gated
    // (STATUS_VALUE.regen), so it must NOT leak onto other effects.
    const block: CardDef = {
      id: 't-block-gate',
      name: 'Block Gate',
      description: '',
      type: 'skill',
      rarity: 'uncommon',
      cost: 1,
      target: 'self',
      effects: [{ kind: 'block', amount: 3 }],
    };
    const expected = ((3 * 0.85) / 1) * 1.35; // BLOCK_VALUE(0.85) unchanged, uncommon
    expect(scoreCard(block)).toBeCloseTo(expected, 10);
  });

  it('regen scoring is deterministic (#53)', () => {
    const trollBlood = cards['troll-blood'] as CardDef;
    expect(scoreCard(trollBlood)).toBe(scoreCard(trollBlood));
  });

  it('values AoE damage above the same single-target damage', () => {
    const single: CardDef = {
      id: 't-single',
      name: 'Single',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 1,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
    };
    const aoe: CardDef = {
      ...single,
      id: 't-aoe',
      target: 'allEnemies',
      effects: [{ kind: 'damage', amount: 6, target: 'allEnemies' }],
    };
    expect(scoreCard(aoe)).toBeGreaterThan(scoreCard(single));
  });
});
