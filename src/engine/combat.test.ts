import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';
import { attackDamage } from './effects.js';
import {
  endTurn,
  isCombatLost,
  isCombatWon,
  playCard,
  startCombat,
} from './combat.js';
import type { ContentRegistry } from './types.js';
import { EngineError } from './types.js';

const T: ContentRegistry = {
  cards: {
    jab: {
      id: 'jab', name: 'Jab', description: '', type: 'attack', rarity: 'common',
      cost: 1, target: 'enemy',
      effects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
    },
    guard: {
      id: 'guard', name: 'Guard', description: '', type: 'skill', rarity: 'common',
      cost: 1, target: 'self',
      effects: [{ kind: 'block', amount: 5 }],
    },
    expose: {
      id: 'expose', name: 'Expose', description: '', type: 'skill', rarity: 'common',
      cost: 0, target: 'enemy',
      effects: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' }],
    },
    pricey: {
      id: 'pricey', name: 'Pricey', description: '', type: 'skill', rarity: 'rare',
      cost: 9, target: 'self',
      effects: [{ kind: 'block', amount: 99 }],
    },
  },
  enemies: {
    dummy: {
      id: 'dummy', name: 'Dummy', hp: [10, 10],
      moves: [{ name: 'Slam', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }] }],
    },
  },
  relics: {},
  events: {},
};

const DECK = ['jab', 'jab', 'guard', 'expose', 'jab'];

function freshCombat() {
  return startCombat(T, DECK, 30, 30, [], ['dummy'], new Rng(1));
}

describe('attackDamage', () => {
  it('applies strength, weak, and vulnerable in order', () => {
    expect(attackDamage(6, {}, {})).toBe(6);
    expect(attackDamage(6, { strength: 2 }, {})).toBe(8);
    expect(attackDamage(6, { strength: 2, weak: 1 }, {})).toBe(6); // floor(8*0.75)
    expect(attackDamage(6, {}, { vulnerable: 1 })).toBe(9); // floor(6*1.5)
    expect(attackDamage(6, { weak: 1 }, { vulnerable: 1 })).toBe(6); // floor(floor(4.5)*1.5)
  });
});

describe('combat flow', () => {
  it('starts with a full hand and full energy', () => {
    const c = freshCombat();
    expect(c.hand).toHaveLength(5);
    expect(c.drawPile).toHaveLength(0);
    expect(c.energy).toBe(3);
    expect(c.enemies[0]?.hp).toBe(10);
  });

  it('playCard deals damage and discards the card', () => {
    const c = freshCombat();
    const jabIndex = c.hand.indexOf('jab');
    const next = playCard(T, c, jabIndex, 0, new Rng(2));
    expect(next.enemies[0]?.hp).toBe(4);
    expect(next.energy).toBe(2);
    expect(next.hand).toHaveLength(4);
    expect(next.discardPile).toContain('jab');
  });

  it('vulnerable amplifies the next hit', () => {
    const c = freshCombat();
    const rng = new Rng(2);
    const exposed = playCard(T, c, c.hand.indexOf('expose'), 0, rng);
    const hit = playCard(T, exposed, exposed.hand.indexOf('jab'), 0, rng);
    expect(hit.enemies[0]?.hp).toBe(1); // 10 - floor(6*1.5)
  });

  it('player block absorbs enemy damage and resets next turn', () => {
    const c = freshCombat();
    const rng = new Rng(2);
    const guarded = playCard(T, c, c.hand.indexOf('guard'), undefined, rng);
    expect(guarded.playerBlock).toBe(5);
    const after = endTurn(T, guarded, rng);
    expect(after.playerHp).toBe(30); // Slam 5 fully absorbed
    expect(after.playerBlock).toBe(0);
    expect(after.turn).toBe(2);
    expect(after.energy).toBe(3);
    expect(after.hand).toHaveLength(5); // reshuffled from discard
  });

  it('statuses decay at round end', () => {
    const c = freshCombat();
    const rng = new Rng(2);
    const exposed = playCard(T, c, c.hand.indexOf('expose'), 0, rng);
    expect(exposed.enemies[0]?.statuses.vulnerable).toBe(2);
    const after = endTurn(T, exposed, rng);
    expect(after.enemies[0]?.statuses.vulnerable).toBe(1);
  });

  it('dexterity increases block gained', () => {
    const c = { ...freshCombat(), playerStatuses: { dexterity: 2 } };
    const guarded = playCard(T, c, c.hand.indexOf('guard'), undefined, new Rng(2));
    expect(guarded.playerBlock).toBe(7); // 5 + 2 dexterity
  });

  it('poison damages the player at round end, bypassing block, then decays', () => {
    const c = { ...freshCombat(), playerBlock: 10, playerStatuses: { poison: 3 }, playerHp: 30 };
    const after = endTurn(T, c, new Rng(2));
    // Slam(5) absorbed by block; round-end poison 3 bypasses block -> hp 27; poison 3->2.
    expect(after.playerHp).toBe(27);
    expect(after.playerStatuses.poison).toBe(2);
  });

  it('poison ticks down enemies at round end', () => {
    const c = freshCombat();
    const enemy = { ...(c.enemies[0] as (typeof c.enemies)[number]), statuses: { poison: 4 } };
    const after = endTurn(T, { ...c, enemies: [enemy] }, new Rng(2));
    expect(after.enemies[0]?.hp).toBe(10 - 4); // 10 base hp - 4 poison
    expect(after.enemies[0]?.statuses.poison).toBe(3);
  });

  it('detects win and loss', () => {
    const c = freshCombat();
    expect(isCombatWon(c)).toBe(false);
    expect(isCombatLost(c)).toBe(false);
    expect(isCombatWon({ ...c, enemies: c.enemies.map((e) => ({ ...e, hp: 0 })) })).toBe(true);
    expect(isCombatLost({ ...c, playerHp: 0 })).toBe(true);
  });

  it('rejects unaffordable and missing cards', () => {
    const c = { ...freshCombat(), hand: ['pricey'] };
    expect(() => playCard(T, c, 0, undefined, new Rng(2))).toThrow(EngineError);
    expect(() => playCard(T, c, 5, undefined, new Rng(2))).toThrow(EngineError);
  });
});
