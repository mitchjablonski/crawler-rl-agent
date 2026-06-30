import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';
import { applyPlayerEffect, getStatus } from './effects.js';
import { content } from './content/index.js';
import type { CombatState, EnemyInstance, Effect, Statuses } from './types.js';

/** Apply every effect of a real card to a combat (no energy/discard bookkeeping). */
function playCardEffects(c: CombatState, cardId: string, targetIndex: number): CombatState {
  let next = c;
  for (const fx of content.cards[cardId]!.effects) {
    next = applyPlayerEffect(next, fx, targetIndex, new Rng(7));
  }
  return next;
}

/** Build a minimal combat with the given enemies; player has no statuses/block. */
function combatWith(enemies: EnemyInstance[]): CombatState {
  return {
    enemies,
    hand: [],
    drawPile: ['rusty-shortsword', 'rusty-shortsword'],
    discardPile: [],
    energy: 3,
    maxEnergy: 3,
    playerHp: 50,
    playerMaxHp: 50,
    playerBlock: 0,
    playerStatuses: {},
    turn: 1,
    dealt: 0,
    taken: 0,
    slain: 0,
  };
}

function enemy(hp: number, statuses: Statuses = {}): EnemyInstance {
  return { defId: 'dummy', name: 'Dummy', hp, maxHp: hp, block: 0, statuses, nextMoveIndex: 0 };
}

const rng = () => new Rng(1);

describe('conditional Effect (#42)', () => {
  it('applies `then` when targetHasStatus holds (poisoned)', () => {
    const c = combatWith([enemy(30, { poison: 2 })]);
    const fx: Effect = {
      kind: 'conditional',
      condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 },
      then: [{ kind: 'damage', amount: 7, target: 'enemy' }],
      else: [{ kind: 'damage', amount: 1, target: 'enemy' }],
    };
    const next = applyPlayerEffect(c, fx, 0, rng());
    expect(next.enemies[0]!.hp).toBe(23); // 30 - 7 (then branch)
    expect(next.dealt).toBe(7); // stat tracking flows through the inner effect
  });

  it('applies `else` (or nothing) when targetHasStatus fails', () => {
    const c = combatWith([enemy(30)]); // not poisoned
    const withElse: Effect = {
      kind: 'conditional',
      condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 },
      then: [{ kind: 'damage', amount: 7, target: 'enemy' }],
      else: [{ kind: 'damage', amount: 1, target: 'enemy' }],
    };
    expect(applyPlayerEffect(c, withElse, 0, rng()).enemies[0]!.hp).toBe(29); // else: -1

    const noElse: Effect = {
      kind: 'conditional',
      condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 },
      then: [{ kind: 'damage', amount: 7, target: 'enemy' }],
    };
    expect(applyPlayerEffect(c, noElse, 0, rng()).enemies[0]!.hp).toBe(30); // unchanged
  });

  it('respects the atLeast threshold', () => {
    const c = combatWith([enemy(30, { poison: 1 })]);
    const fx: Effect = {
      kind: 'conditional',
      condition: { type: 'targetHasStatus', status: 'poison', atLeast: 3 },
      then: [{ kind: 'damage', amount: 7, target: 'enemy' }],
    };
    expect(applyPlayerEffect(c, fx, 0, rng()).enemies[0]!.hp).toBe(30); // 1 < 3 → no bonus
  });

  it('enemyCount eq 1 gates a single-target floor', () => {
    const fx: Effect = {
      kind: 'conditional',
      condition: { type: 'enemyCount', op: 'eq', value: 1 },
      then: [{ kind: 'damage', amount: 5, target: 'allEnemies' }],
    };
    expect(applyPlayerEffect(combatWith([enemy(30)]), fx, 0, rng()).enemies[0]!.hp).toBe(25);
    // Two living enemies → condition false → no bonus.
    const two = combatWith([enemy(30), enemy(30)]);
    const after = applyPlayerEffect(two, fx, 0, rng());
    expect(after.enemies.map((e) => e.hp)).toEqual([30, 30]);
  });

  it('enemyCount counts only LIVING enemies', () => {
    const fx: Effect = {
      kind: 'conditional',
      condition: { type: 'enemyCount', op: 'eq', value: 1 },
      then: [{ kind: 'damage', amount: 5, target: 'allEnemies' }],
    };
    // One dead + one alive = 1 living → floor applies (only the living one takes it).
    const c = combatWith([enemy(0), enemy(30)]);
    const after = applyPlayerEffect(c, fx, 1, rng());
    expect(after.enemies[1]!.hp).toBe(25);
  });

  it('nests: a conditional whose `then` is applyStatus + damage', () => {
    const c = combatWith([enemy(30, { poison: 1 })]);
    const fx: Effect = {
      kind: 'conditional',
      condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 },
      then: [
        { kind: 'applyStatus', status: 'poison', stacks: 2, target: 'enemy' },
        { kind: 'damage', amount: 4, target: 'enemy' },
      ],
    };
    const next = applyPlayerEffect(c, fx, 0, rng());
    expect(getStatus(next.enemies[0]!.statuses, 'poison')).toBe(3); // 1 + 2
    expect(next.enemies[0]!.hp).toBe(26); // -4
  });
});

describe('conditional cards in content (#42)', () => {
  it('lucky-dagger deals 7 cold, 14 vs a poisoned target', () => {
    const cold = playCardEffects(combatWith([enemy(40)]), 'lucky-dagger', 0);
    expect(40 - cold.enemies[0]!.hp).toBe(7);

    const poisoned = playCardEffects(combatWith([enemy(40, { poison: 1 })]), 'lucky-dagger', 0);
    expect(40 - poisoned.enemies[0]!.hp).toBe(14); // 7 base + 7 conditional bonus
  });

  it('lucky-dagger-plus deals 9 cold, 18 vs a poisoned target', () => {
    const cold = playCardEffects(combatWith([enemy(40)]), 'lucky-dagger-plus', 0);
    expect(40 - cold.enemies[0]!.hp).toBe(9);
    const poisoned = playCardEffects(combatWith([enemy(40, { poison: 4 })]), 'lucky-dagger-plus', 0);
    expect(40 - poisoned.enemies[0]!.hp).toBe(18);
  });

  it('whirlwind floors at 11 vs a lone enemy, 6 each vs a pack', () => {
    const lone = playCardEffects(combatWith([enemy(40)]), 'whirlwind', 0);
    expect(40 - lone.enemies[0]!.hp).toBe(11); // 6 AoE + 5 single-target floor

    const pack = playCardEffects(combatWith([enemy(40), enemy(40)]), 'whirlwind', 0);
    expect(pack.enemies.map((e) => 40 - e.hp)).toEqual([6, 6]); // floor inert vs 2
  });

  it('whirlwind-plus floors at 15 vs a lone enemy, 9 each vs a pack', () => {
    const lone = playCardEffects(combatWith([enemy(40)]), 'whirlwind-plus', 0);
    expect(40 - lone.enemies[0]!.hp).toBe(15); // 9 + 6
    const pack = playCardEffects(combatWith([enemy(40), enemy(40)]), 'whirlwind-plus', 0);
    expect(pack.enemies.map((e) => 40 - e.hp)).toEqual([9, 9]);
  });
});
