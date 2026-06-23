import type { Rng } from './rng.js';
import type {
  CombatState,
  Effect,
  EnemyInstance,
  Statuses,
  StatusId,
  TargetKind,
} from './types.js';
import { EngineError } from './types.js';

export function getStatus(statuses: Statuses, id: StatusId): number {
  return statuses[id] ?? 0;
}

export function addStatus(statuses: Statuses, id: StatusId, stacks: number): Statuses {
  const next = getStatus(statuses, id) + stacks;
  if (next <= 0) {
    const rest = { ...statuses };
    delete rest[id];
    return rest;
  }
  return { ...statuses, [id]: next };
}

/** base + strength, ×0.75 if attacker weak, ×1.5 if defender vulnerable. */
export function attackDamage(base: number, attacker: Statuses, defender: Statuses): number {
  let dmg = base + getStatus(attacker, 'strength');
  if (getStatus(attacker, 'weak') > 0) dmg = Math.floor(dmg * 0.75);
  if (getStatus(defender, 'vulnerable') > 0) dmg = Math.floor(dmg * 1.5);
  return Math.max(0, dmg);
}

function hitEnemy(enemy: EnemyInstance, dmg: number): EnemyInstance {
  const absorbed = Math.min(enemy.block, dmg);
  return {
    ...enemy,
    block: enemy.block - absorbed,
    hp: Math.max(0, enemy.hp - (dmg - absorbed)),
  };
}

function hitPlayer(combat: CombatState, dmg: number): CombatState {
  const absorbed = Math.min(combat.playerBlock, dmg);
  return {
    ...combat,
    playerBlock: combat.playerBlock - absorbed,
    playerHp: Math.max(0, combat.playerHp - (dmg - absorbed)),
  };
}

export function drawCards(combat: CombatState, count: number, rng: Rng): CombatState {
  const hand = [...combat.hand];
  let drawPile = [...combat.drawPile];
  let discardPile = [...combat.discardPile];
  for (let i = 0; i < count; i++) {
    if (drawPile.length === 0) {
      if (discardPile.length === 0) break;
      drawPile = rng.shuffle(discardPile);
      discardPile = [];
    }
    hand.push(drawPile.shift() as string);
  }
  return { ...combat, hand, drawPile, discardPile };
}

/** Apply one effect played by the player. targetIndex selects the enemy for 'enemy'-targeted effects. */
export function applyPlayerEffect(
  combat: CombatState,
  effect: Effect,
  targetIndex: number | undefined,
  rng: Rng,
): CombatState {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times ?? 1;
      let next = combat;
      for (let t = 0; t < times; t++) {
        const indices = targetIndices(next, effect.target, targetIndex);
        const enemies = next.enemies.map((e, i) =>
          indices.includes(i) && e.hp > 0
            ? hitEnemy(e, attackDamage(effect.amount, next.playerStatuses, e.statuses))
            : e,
        );
        next = { ...next, enemies };
      }
      return next;
    }
    case 'block':
      return {
        ...combat,
        playerBlock:
          combat.playerBlock +
          Math.max(0, effect.amount + getStatus(combat.playerStatuses, 'dexterity')),
      };
    case 'draw':
      return drawCards(combat, effect.count, rng);
    case 'gainEnergy':
      return { ...combat, energy: combat.energy + effect.amount };
    case 'heal':
      return {
        ...combat,
        playerHp: Math.min(combat.playerMaxHp, combat.playerHp + effect.amount),
      };
    case 'applyStatus': {
      if (effect.target === 'self') {
        return {
          ...combat,
          playerStatuses: addStatus(combat.playerStatuses, effect.status, effect.stacks),
        };
      }
      const indices = targetIndices(combat, effect.target, targetIndex);
      const enemies = combat.enemies.map((e, i) =>
        indices.includes(i) && e.hp > 0
          ? { ...e, statuses: addStatus(e.statuses, effect.status, effect.stacks) }
          : e,
      );
      return { ...combat, enemies };
    }
  }
}

/** Apply one effect performed by the enemy at enemyIndex ('enemy' target = the player). */
export function applyEnemyEffect(
  combat: CombatState,
  enemyIndex: number,
  effect: Effect,
): CombatState {
  const self = combat.enemies[enemyIndex];
  if (!self) throw new EngineError(`no enemy at index ${enemyIndex}`);
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times ?? 1;
      let next = combat;
      for (let t = 0; t < times; t++) {
        next = hitPlayer(
          next,
          attackDamage(effect.amount, self.statuses, next.playerStatuses),
        );
      }
      return next;
    }
    case 'block': {
      const enemies = combat.enemies.map((e, i) =>
        i === enemyIndex
          ? { ...e, block: e.block + Math.max(0, effect.amount + getStatus(e.statuses, 'dexterity')) }
          : e,
      );
      return { ...combat, enemies };
    }
    case 'heal': {
      const enemies = combat.enemies.map((e, i) =>
        i === enemyIndex ? { ...e, hp: Math.min(e.maxHp, e.hp + effect.amount) } : e,
      );
      return { ...combat, enemies };
    }
    case 'applyStatus': {
      if (effect.target === 'self') {
        const enemies = combat.enemies.map((e, i) =>
          i === enemyIndex
            ? { ...e, statuses: addStatus(e.statuses, effect.status, effect.stacks) }
            : e,
        );
        return { ...combat, enemies };
      }
      return {
        ...combat,
        playerStatuses: addStatus(combat.playerStatuses, effect.status, effect.stacks),
      };
    }
    // Enemies have no hand or energy; these are player-only primitives.
    case 'draw':
    case 'gainEnergy':
      return combat;
  }
}

/**
 * Target validity is checked once when the card is played (combat.ts); here a
 * target that died mid-card resolves as a no-op, so multi-effect cards finish.
 */
function targetIndices(
  combat: CombatState,
  target: TargetKind,
  targetIndex: number | undefined,
): number[] {
  if (target === 'allEnemies') return combat.enemies.map((_, i) => i);
  if (target === 'self') return [];
  if (targetIndex === undefined) throw new EngineError('this effect requires a target');
  if (!combat.enemies[targetIndex]) throw new EngineError(`invalid target ${targetIndex}`);
  return [targetIndex];
}
