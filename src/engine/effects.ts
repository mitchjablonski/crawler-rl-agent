import type { Rng } from './rng.js';
import type {
  CombatState,
  Effect,
  EffectCondition,
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

/**
 * #62 overheat gradient: the continuous bonus an effect's amount gains from the
 * player's MISSING HP — `floor((playerMaxHp - playerHp) / divisor)`. Returns 0
 * when `divisor` is absent (every existing effect → byte-identical) or when the
 * player is at full HP. Pure, draws no rng. Naturally bounded by maxHp.
 */
function missingHpBonus(combat: CombatState, divisor: number | undefined): number {
  if (divisor === undefined) return 0;
  return Math.floor((combat.playerMaxHp - combat.playerHp) / divisor);
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
      // #62 overheat gradient: add the missing-HP bonus to the PER-HIT base so it
      // is applied to every hit (intentional). NOTE: combining a large `times`
      // with `scaleMissingHp` multiplies the bonus across hits and is degenerate;
      // it is intentionally avoided in content (no card carries both).
      const base = effect.amount + missingHpBonus(combat, effect.scaleMissingHp);
      let next = combat;
      for (let t = 0; t < times; t++) {
        const indices = targetIndices(next, effect.target, targetIndex);
        // Passive, deterministic stat tracking (no rng, no behavior change):
        // accumulate HP actually removed from enemies (post-block) and count
        // each alive→dead transition caused by THIS player damage.
        let dealt = 0;
        let slain = 0;
        const enemies = next.enemies.map((e, i) => {
          if (!indices.includes(i) || e.hp <= 0) return e;
          const hit = hitEnemy(e, attackDamage(base, next.playerStatuses, e.statuses));
          dealt += e.hp - hit.hp;
          if (hit.hp <= 0) slain += 1;
          return hit;
        });
        next = { ...next, enemies, dealt: next.dealt + dealt, slain: next.slain + slain };
      }
      return next;
    }
    case 'block':
      return {
        ...combat,
        playerBlock:
          combat.playerBlock +
          Math.max(
            0,
            // #62: missing-HP bonus is injected into the amount BEFORE dexterity.
            effect.amount +
              missingHpBonus(combat, effect.scaleMissingHp) +
              getStatus(combat.playerStatuses, 'dexterity'),
          ),
      };
    case 'loseHp': {
      // #62 overheat: an unblockable, rng-free HP COST. Ignores block (it is a
      // cost, not an attack) and FLOORS AT 1 — a self-cost must never be lethal.
      const afterHp = Math.max(1, combat.playerHp - effect.amount);
      // #68 overcharge: SELF-INFLICTED overheat (this loseHp path only — NOT the
      // enemy `hitPlayer` path) converts heat into permanent power. With N stacks
      // of `overcharge`, each overheat grants N Strength. Pure, draws no rng; a
      // strict no-op when overcharge is 0, so existing overheat cards/runs are
      // byte-identical. This is the class-asymmetry hook for `overdrive-core`.
      const overcharge = getStatus(combat.playerStatuses, 'overcharge');
      const playerStatuses =
        overcharge > 0 ? addStatus(combat.playerStatuses, 'strength', overcharge) : combat.playerStatuses;
      return { ...combat, playerHp: afterHp, playerStatuses };
    }
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
    case 'conditional': {
      // Pure, deterministic branch over current state (no rng draws). The chosen
      // branch's effects flow through the SAME path (recurse) with the same
      // targetIndex, so target resolution + stat tracking (#25) are unchanged.
      const branch = evalCondition(combat, effect.condition, targetIndex)
        ? effect.then
        : (effect.else ?? []);
      let next = combat;
      for (const inner of branch) {
        next = applyPlayerEffect(next, inner, targetIndex, rng);
      }
      return next;
    }
  }
}

/**
 * Evaluate a conditional Effect's predicate against the CURRENT combat state.
 * Pure & deterministic: reads only state + the selected target, draws no rng.
 */
function evalCondition(
  combat: CombatState,
  condition: EffectCondition,
  targetIndex: number | undefined,
): boolean {
  switch (condition.type) {
    case 'targetHasStatus': {
      const need = condition.atLeast ?? 1;
      // Read the status off the SELECTED enemy when one is targeted; otherwise
      // (e.g. a self/aoe context) fall back to the first living enemy so an
      // allEnemies card can still gate on "the pack is poisoned".
      const enemy =
        targetIndex !== undefined
          ? combat.enemies[targetIndex]
          : combat.enemies.find((e) => e.hp > 0);
      if (!enemy) return false;
      return getStatus(enemy.statuses, condition.status) >= need;
    }
    case 'enemyCount': {
      const living = combat.enemies.filter((e) => e.hp > 0).length;
      if (condition.op === 'eq') return living === condition.value;
      if (condition.op === 'lte') return living <= condition.value;
      return living >= condition.value;
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
        const before = next.playerHp;
        next = hitPlayer(
          next,
          attackDamage(effect.amount, self.statuses, next.playerStatuses),
        );
        // Passive stat tracking: HP the player actually lost (post-block).
        next = { ...next, taken: next.taken + (before - next.playerHp) };
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
    // Enemies have no hand or energy; these are player-only primitives. The
    // `conditional` kind is authored only on player-facing content (#42), and
    // `loseHp` is the player's overheat self-cost (#62) — both are inert no-ops
    // here; enemy moves never carry them (enemies don't scale on player HP).
    case 'draw':
    case 'gainEnergy':
    case 'conditional':
    case 'loseHp':
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
