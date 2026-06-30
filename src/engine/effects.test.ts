import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';
import { applyEnemyEffect, applyPlayerEffect } from './effects.js';
import type { CombatState, EnemyInstance, Effect, Statuses } from './types.js';

/** Build a minimal combat; overrides let a test set player HP/block precisely. */
function combatWith(
  enemies: EnemyInstance[],
  overrides: Partial<CombatState> = {},
): CombatState {
  return {
    enemies,
    hand: [],
    drawPile: [],
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
    ...overrides,
  };
}

function enemy(hp: number, statuses: Statuses = {}): EnemyInstance {
  return { defId: 'dummy', name: 'Dummy', hp, maxHp: hp, block: 0, statuses, nextMoveIndex: 0 };
}

describe('loseHp effect (#62 overheat self-cost)', () => {
  it('reduces playerHp by the amount (unblockable)', () => {
    const c = combatWith([enemy(30)], { playerHp: 40 });
    const fx: Effect = { kind: 'loseHp', amount: 6 };
    expect(applyPlayerEffect(c, fx, undefined, new Rng(1)).playerHp).toBe(34);
  });

  it('floors at 1 — a self-cost is never lethal', () => {
    const c = combatWith([enemy(30)], { playerHp: 3 });
    const fx: Effect = { kind: 'loseHp', amount: 5 };
    expect(applyPlayerEffect(c, fx, undefined, new Rng(1)).playerHp).toBe(1);
  });

  it('ignores block (it is a cost, not an attack)', () => {
    const c = combatWith([enemy(30)], { playerHp: 40, playerBlock: 20 });
    const fx: Effect = { kind: 'loseHp', amount: 6 };
    const next = applyPlayerEffect(c, fx, undefined, new Rng(1));
    expect(next.playerBlock).toBe(20); // block untouched
    expect(next.playerHp).toBe(34); // full cost lands
  });

  it('consumes no rng (stream byte-identical with vs without)', () => {
    const c = combatWith([enemy(30)], { playerHp: 40 });
    const rng = new Rng(123);
    const stateBefore = rng.state();
    applyPlayerEffect(c, { kind: 'loseHp', amount: 6 }, undefined, rng);
    expect(rng.state()).toBe(stateBefore);
  });
});

describe('overcharge (#68 overheat -> Strength)', () => {
  it('grants Strength equal to overcharge stacks on a loseHp overheat', () => {
    const c = combatWith([enemy(30)], { playerHp: 40, playerStatuses: { overcharge: 2 } });
    const next = applyPlayerEffect(c, { kind: 'loseHp', amount: 3 }, undefined, new Rng(1));
    expect(next.playerHp).toBe(37); // cost still lands
    expect(next.playerStatuses.strength).toBe(2); // +overcharge Strength
    expect(next.playerStatuses.overcharge).toBe(2); // overcharge itself unchanged
  });

  it('stacks onto existing Strength each overheat (scales over a fight)', () => {
    let c = combatWith([enemy(30)], { playerHp: 50, playerStatuses: { overcharge: 1, strength: 1 } });
    c = applyPlayerEffect(c, { kind: 'loseHp', amount: 2 }, undefined, new Rng(1));
    c = applyPlayerEffect(c, { kind: 'loseHp', amount: 2 }, undefined, new Rng(1));
    expect(c.playerStatuses.strength).toBe(3); // 1 + 1 + 1 over two overheats
  });

  it('with no overcharge, loseHp grants no Strength', () => {
    const c = combatWith([enemy(30)], { playerHp: 40 });
    const next = applyPlayerEffect(c, { kind: 'loseHp', amount: 3 }, undefined, new Rng(1));
    expect(next.playerStatuses.strength).toBeUndefined();
  });

  it('the overheat->Strength hook draws no rng (deterministic)', () => {
    const c = combatWith([enemy(30)], { playerHp: 40, playerStatuses: { overcharge: 3 } });
    const rng = new Rng(7);
    const stateBefore = rng.state();
    applyPlayerEffect(c, { kind: 'loseHp', amount: 4 }, undefined, rng);
    expect(rng.state()).toBe(stateBefore);
  });

  it('only SELF-inflicted loseHp triggers it — enemy damage does not', () => {
    // Enemy damage flows through hitPlayer (applyEnemyEffect), a different path,
    // so a player with overcharge gains NO Strength when an enemy hits them.
    const c = combatWith([enemy(30)], { playerHp: 40, playerStatuses: { overcharge: 2 } });
    const hit = applyEnemyEffect(c, 0, { kind: 'damage', amount: 6, target: 'enemy' });
    expect(hit.playerHp).toBe(34);
    expect(hit.playerStatuses.strength).toBeUndefined();
  });
});

describe('scaleMissingHp gradient (#62)', () => {
  it('adds floor(missingHp / N) to damage and grows as HP drops', () => {
    const fx: Effect = { kind: 'damage', amount: 5, target: 'enemy', scaleMissingHp: 4 };
    // 20 missing HP / 4 = +5 → base 10.
    const low = combatWith([enemy(40)], { playerHp: 30, playerMaxHp: 50 });
    expect(40 - applyPlayerEffect(low, fx, 0, new Rng(1)).enemies[0]!.hp).toBe(10);
    // 32 missing / 4 = +8 → base 13 (grows as HP drops further).
    const lower = combatWith([enemy(40)], { playerHp: 18, playerMaxHp: 50 });
    expect(40 - applyPlayerEffect(lower, fx, 0, new Rng(1)).enemies[0]!.hp).toBe(13);
  });

  it('adds floor(missingHp / N) to block', () => {
    const fx: Effect = { kind: 'block', amount: 5, scaleMissingHp: 4 };
    // 20 missing / 4 = +5 → 10 block.
    const c = combatWith([enemy(40)], { playerHp: 30, playerMaxHp: 50 });
    expect(applyPlayerEffect(c, fx, undefined, new Rng(1)).playerBlock).toBe(10);
  });

  it('bonus is 0 at full HP (damage and block)', () => {
    const full = combatWith([enemy(40)], { playerHp: 50, playerMaxHp: 50 });
    const dmg: Effect = { kind: 'damage', amount: 5, target: 'enemy', scaleMissingHp: 4 };
    expect(40 - applyPlayerEffect(full, dmg, 0, new Rng(1)).enemies[0]!.hp).toBe(5);
    const blk: Effect = { kind: 'block', amount: 5, scaleMissingHp: 4 };
    expect(applyPlayerEffect(full, blk, undefined, new Rng(1)).playerBlock).toBe(5);
  });

  it('the gradient bonus stacks with strength before the pipeline', () => {
    const fx: Effect = { kind: 'damage', amount: 5, target: 'enemy', scaleMissingHp: 4 };
    // 20 missing / 4 = +5 → base 10, then +2 strength = 12.
    const c = combatWith([enemy(40)], {
      playerHp: 30,
      playerMaxHp: 50,
      playerStatuses: { strength: 2 },
    });
    expect(40 - applyPlayerEffect(c, fx, 0, new Rng(1)).enemies[0]!.hp).toBe(12);
  });

  it('consumes no rng', () => {
    const c = combatWith([enemy(40)], { playerHp: 30, playerMaxHp: 50 });
    const rng = new Rng(99);
    const before = rng.state();
    applyPlayerEffect(c, { kind: 'damage', amount: 5, target: 'enemy', scaleMissingHp: 4 }, 0, rng);
    expect(rng.state()).toBe(before);
  });
});

describe('additions are inert for existing-kind content (#62 determinism)', () => {
  it('a damage/block resolution with no new fields is byte-identical', () => {
    // Same fight, same rng — the new code paths must not change old behavior.
    const make = () =>
      combatWith([enemy(40), enemy(40)], { playerHp: 30, playerMaxHp: 50, playerBlock: 2 });
    const seq: Effect[] = [
      { kind: 'damage', amount: 6, target: 'enemy' },
      { kind: 'damage', amount: 3, target: 'allEnemies', times: 2 },
      { kind: 'block', amount: 5 },
    ];
    const run = () => {
      let c = make();
      const rng = new Rng(2024);
      for (const fx of seq) c = applyPlayerEffect(c, fx, 0, rng);
      return { combat: c, rngState: rng.state() };
    };
    expect(run()).toEqual(run());
  });
});
