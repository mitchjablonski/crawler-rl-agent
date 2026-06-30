import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';
import { attackDamage } from './effects.js';
import {
  applyRelics,
  endTurn,
  isCombatLost,
  isCombatWon,
  playCard,
  startCombat,
  usePotion,
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
  potions: {
    bomb: {
      id: 'bomb', name: 'Bomb', description: '',
      target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }],
    },
    tonic: {
      id: 'tonic', name: 'Tonic', description: '',
      target: 'self', effects: [{ kind: 'block', amount: 7 }],
    },
  },
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

  it('#68: overcharge is permanent — it does NOT decay at round end', () => {
    const c = { ...freshCombat(), playerStatuses: { overcharge: 2, strength: 1 } };
    const after = endTurn(T, c, new Rng(2));
    expect(after.playerStatuses.overcharge).toBe(2); // permanent, like strength
    expect(after.playerStatuses.strength).toBe(1);
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

describe('relic triggers at the playCard chokepoint', () => {
  // A content registry with the new-trigger relics layered onto T's cards/enemies.
  const R: ContentRegistry = {
    ...T,
    cards: {
      ...T.cards,
      // hits ALL enemies for 6 — used to test per-kill onKill firing on AoE.
      sweep: {
        id: 'sweep', name: 'Sweep', description: '', type: 'attack', rarity: 'common',
        cost: 1, target: 'allEnemies',
        effects: [{ kind: 'damage', amount: 6, target: 'allEnemies' }],
      },
    },
    relics: {
      onPlayBlock: {
        id: 'onPlayBlock', name: 'On Play Block', description: '',
        trigger: 'onCardPlayed', effects: [{ kind: 'block', amount: 1 }],
      },
      onKillStr: {
        id: 'onKillStr', name: 'On Kill Strength', description: '',
        trigger: 'onKill', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }],
      },
      comeback: {
        id: 'comeback', name: 'Comeback', description: '',
        trigger: 'turnStart', condition: { kind: 'hpBelow', pct: 50 },
        effects: [{ kind: 'block', amount: 6 }],
      },
    },
  };

  const weakEnemies: ContentRegistry['enemies'] = {
    weakling: {
      id: 'weakling', name: 'Weakling', hp: [6, 6],
      moves: [{ name: 'Tap', effects: [{ kind: 'damage', amount: 1, target: 'enemy' }] }],
    },
  };

  it('onCardPlayed fires once after a card (owner gains the effect)', () => {
    const c = freshCombat();
    const idx = c.hand.indexOf('guard');
    const next = playCard(R, c, idx, undefined, new Rng(2), ['onPlayBlock']);
    // guard gives 5 block + 1 from the relic = 6.
    expect(next.playerBlock).toBe(6);
  });

  it('onKill fires when a card kills an enemy', () => {
    const env: ContentRegistry = { ...R, enemies: weakEnemies };
    const c = startCombat(env, DECK, 30, 30, [], ['weakling'], new Rng(1));
    const idx = c.hand.indexOf('jab'); // 6 dmg vs 6 hp = kill
    const next = playCard(env, c, idx, 0, new Rng(2), ['onKillStr']);
    expect(next.enemies[0]?.hp).toBe(0);
    expect(next.playerStatuses.strength).toBe(1);
  });

  it('onKill fires once per kill on an AoE multi-kill', () => {
    const env: ContentRegistry = { ...R, enemies: weakEnemies };
    const c = startCombat(env, ['sweep'], 30, 30, [], ['weakling', 'weakling'], new Rng(1));
    const idx = c.hand.indexOf('sweep'); // 6 dmg to all, both at 6 hp = 2 kills
    const next = playCard(env, c, idx, undefined, new Rng(2), ['onKillStr']);
    expect(next.enemies.every((e) => e.hp === 0)).toBe(true);
    expect(next.playerStatuses.strength).toBe(2); // one stack per kill
  });

  it('hpBelow conditional fires only below the threshold', () => {
    const c = freshCombat();
    const healthy = applyRelics(R, { ...c, playerHp: 30, playerMaxHp: 30 }, ['comeback'], 'turnStart', new Rng(2));
    expect(healthy.playerBlock).toBe(0); // 100% HP -> no fire
    const hurt = applyRelics(R, { ...c, playerHp: 10, playerMaxHp: 30 }, ['comeback'], 'turnStart', new Rng(2));
    expect(hurt.playerBlock).toBe(6); // ~33% HP -> fires
  });

  it('no-matching-relic playCard is byte-identical (determinism invariant)', () => {
    const c = freshCombat();
    const idx = c.hand.indexOf('jab');
    const baseline = playCard(T, c, idx, 0, new Rng(7)); // no relics arg (pre-D4 path)
    // Same card, with a relic set containing NO onKill/onCardPlayed relics: the
    // new firing sites must consume no rng and change no state.
    const withRelics = playCard(R, c, idx, 0, new Rng(7), ['comeback']);
    expect(withRelics).toEqual(baseline);
  });
});

describe('usePotion', () => {
  it('applies a self potion without a target and costs no energy', () => {
    const c = freshCombat();
    const after = usePotion(T.potions.tonic!, c, undefined, new Rng(2));
    expect(after.playerBlock).toBe(7);
    expect(after.energy).toBe(c.energy); // potions are not cards: no energy spent
  });

  it('applies an enemy potion to the chosen target', () => {
    const c = freshCombat();
    const after = usePotion(T.potions.bomb!, c, 0, new Rng(2));
    expect(after.enemies[0]?.hp).toBe(10 - 8);
  });

  it('rejects an enemy potion with no living target', () => {
    const c = freshCombat();
    const dead = { ...c, enemies: c.enemies.map((e) => ({ ...e, hp: 0 })) };
    expect(() => usePotion(T.potions.bomb!, dead, 0, new Rng(2))).toThrow(EngineError);
    expect(() => usePotion(T.potions.bomb!, c, undefined, new Rng(2))).toThrow(EngineError);
  });
});

describe('phase changes in combat', () => {
  // A boss with a base pool (len 2) and an enraged pool (len 3) that activates
  // at/under 50% HP. The differing pool lengths catch index-vs-pool mismatches.
  const PT: ContentRegistry = {
    ...T,
    enemies: {
      boss: {
        id: 'boss', name: 'Boss', hp: [100, 100], isBoss: true,
        moves: [
          { name: 'Tap', effects: [{ kind: 'damage', amount: 1, target: 'enemy' }] },
          { name: 'Stall', effects: [{ kind: 'block', amount: 5 }] },
        ],
        phases: [
          {
            hpThreshold: 0.5, name: 'Enraged',
            moves: [
              { name: 'Signature', effects: [{ kind: 'damage', amount: 20, target: 'enemy' }] },
              { name: 'Jab', effects: [{ kind: 'damage', amount: 2, target: 'enemy' }] },
              { name: 'Hook', effects: [{ kind: 'damage', amount: 3, target: 'enemy' }] },
            ],
          },
        ],
      },
    },
  };

  function bossCombat(hp: number, nextMoveIndex: number) {
    const c = startCombat(PT, DECK, 200, 200, [], ['boss'], new Rng(1));
    return {
      ...c,
      enemies: c.enemies.map((e) => ({ ...e, hp, maxHp: 100, nextMoveIndex })),
    };
  }

  it('uses the base pool above the threshold', () => {
    const c = bossCombat(80, 0); // 80% -> base move 0 = Tap (1 dmg)
    const after = endTurn(PT, c, new Rng(9));
    expect(after.playerHp).toBe(200 - 1);
    // index advanced against base pool length (2): 0 -> 1
    expect(after.enemies[0]?.nextMoveIndex).toBe(1);
  });

  it('switches to the enraged signature once HP drops below the threshold', () => {
    const c = bossCombat(40, 0); // 40% -> enraged move 0 = Signature (20 dmg)
    const after = endTurn(PT, c, new Rng(9));
    expect(after.playerHp).toBe(200 - 20);
    // index advanced against ENRAGED pool length (3): 0 -> 1
    expect(after.enemies[0]?.nextMoveIndex).toBe(1);
  });

  it('advances the index consistently against the active pool (no wrap mismatch)', () => {
    // nextMoveIndex 2 in the base pool (len 2) would be out of range; the
    // enraged pool (len 3) maps index 2 -> Hook, and advances 2 -> 0 % 3.
    const c = bossCombat(10, 2);
    const after = endTurn(PT, c, new Rng(9));
    expect(after.playerHp).toBe(200 - 3); // Hook
    expect(after.enemies[0]?.nextMoveIndex).toBe(0);
  });
});
