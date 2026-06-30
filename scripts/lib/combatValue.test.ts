import { describe, expect, it } from 'vitest';
import { combatValue, poisonLifetimeValue, predictIncomingDamage } from './combatValue.js';
import { cards } from '../../src/engine/content/cards.js';
import { content } from '../../src/engine/content/index.js';
import type { CardDef, CombatState, EnemyInstance, Statuses } from '../../src/engine/types.js';

// Tooling-only unit tests for the #57 state-aware combat-value heuristic. It is a
// pure, deterministic, ONE-PLY estimate of how good it is to play a card right
// now against a chosen target, used by the greedy playtest policy so it stops
// playing poison/DoT blind. These pin the properties the policy relies on:
// poison valued above its face, payoff cards armed only when the target is
// poisoned past the threshold, and determinism — NOT exact magnitudes.

function enemy(over: Partial<EnemyInstance> = {}): EnemyInstance {
  return {
    defId: 'dummy',
    name: 'Dummy',
    hp: 100,
    maxHp: 100,
    block: 0,
    statuses: {},
    nextMoveIndex: 0,
    ...over,
  };
}

function combat(enemies: EnemyInstance[], over: Partial<CombatState> = {}): CombatState {
  return {
    enemies,
    hand: [],
    drawPile: [],
    discardPile: [],
    energy: 3,
    maxEnergy: 3,
    playerHp: 60,
    playerMaxHp: 60,
    playerBlock: 0,
    playerStatuses: {} as Statuses,
    turn: 1,
    dealt: 0,
    taken: 0,
    slain: 0,
    ...over,
  };
}

describe('combatValue', () => {
  it('is deterministic (same input -> same value)', () => {
    const c = cards['tipped-blade'] as CardDef;
    const state = combat([enemy()]);
    expect(combatValue(c, state, 0)).toBe(combatValue(c, state, 0));
  });

  it('values poison ABOVE its raw face value (cumulative DoT)', () => {
    // venom-dart applies 3 poison (0 dmg). Its cumulative worth f(3)=6 must beat
    // a plain 3-damage strike — poison is not a one-shot 3 points.
    const venomDart = cards['venom-dart'] as CardDef;
    const strike: CardDef = {
      id: 't-strike',
      name: 'T Strike',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 0,
      target: 'enemy',
      effects: [{ kind: 'damage', amount: 3, target: 'enemy' }],
    };
    const state = combat([enemy()]);
    expect(combatValue(venomDart, state, 0)).toBeGreaterThan(combatValue(strike, state, 0));
  });

  it('cumulative poison rewards stacking on an already-poisoned enemy', () => {
    // Adding 3 poison is worth more when the target already carries poison.
    expect(poisonLifetimeValue(5, 3)).toBeGreaterThan(poisonLifetimeValue(0, 3));
  });

  it('values a poison-payoff card HIGH only when the target meets the threshold', () => {
    // Detonation Vial: 8 dmg, +18 more if the target has >=5 poison. It must be
    // worth far more vs a heavily-poisoned target than a clean one (detonation
    // timing), and prefer the armed enemy when targeting.
    const vial = cards['poison-finisher'] as CardDef;
    const clean = combat([enemy()]);
    const armed = combat([enemy({ statuses: { poison: 6 } })]);
    expect(combatValue(vial, armed, 0)).toBeGreaterThan(combatValue(vial, clean, 0) + 10);

    // Sub-threshold poison (4 < 5) must NOT arm the payoff.
    const under = combat([enemy({ statuses: { poison: 4 } })]);
    expect(combatValue(vial, under, 0)).toBeCloseTo(combatValue(vial, clean, 0), 5);
  });

  it('prefers the already-poisoned enemy for a payoff card across targets', () => {
    const vial = cards['poison-finisher'] as CardDef;
    const state = combat([enemy(), enemy({ statuses: { poison: 6 } })]);
    expect(combatValue(vial, state, 1)).toBeGreaterThan(combatValue(vial, state, 0));
  });

  it('values block by what it PREVENTS of incoming damage', () => {
    const guard: CardDef = {
      id: 't-guard',
      name: 'T Guard',
      description: '',
      type: 'skill',
      rarity: 'common',
      cost: 1,
      target: 'self',
      effects: [{ kind: 'block', amount: 8 }],
    };
    const state = combat([enemy()]);
    // With a big incoming hit, block is worth far more than when nothing is
    // coming (where it is mostly wasted overflow).
    const underThreat = combatValue(guard, state, undefined, { incoming: 12 });
    const noThreat = combatValue(guard, state, undefined, { incoming: 0 });
    expect(underThreat).toBeGreaterThan(noThreat);
  });

  it('predictIncomingDamage reads telegraphed enemy moves (real content)', () => {
    const def = content.enemies['lint-goblin'];
    expect(def).toBeDefined();
    // Scan the move cycle: at least one telegraphed move is an attack, so some
    // seeding yields positive predicted incoming damage (proves it reads moves).
    const seen = def!.moves.map((_m, i) =>
      predictIncomingDamage(combat([enemy({ defId: 'lint-goblin', nextMoveIndex: i })]), content),
    );
    expect(Math.max(...seen)).toBeGreaterThan(0);
  });

  it('does not inflate overkill: 999 dmg == exactly-lethal dmg vs a 7 HP enemy', () => {
    const make = (amount: number): CardDef => ({
      id: `t-${amount}`,
      name: 'T',
      description: '',
      type: 'attack',
      rarity: 'common',
      cost: 1,
      target: 'enemy',
      effects: [{ kind: 'damage', amount, target: 'enemy' }],
    });
    const state = combat([enemy({ hp: 7, maxHp: 7 })]);
    // A massive overkill is valued the SAME as a just-lethal hit (HP-capped +
    // the flat kill bonus) — overkill HP is never counted.
    expect(combatValue(make(999), state, 0)).toBe(combatValue(make(7), state, 0));
    // And a non-lethal chip (6 < 7) is worth strictly less (no kill bonus).
    expect(combatValue(make(6), state, 0)).toBeLessThan(combatValue(make(7), state, 0));
  });
});
