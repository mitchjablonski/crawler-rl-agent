import type { Rng } from './rng.js';
import type {
  CombatState,
  ContentRegistry,
  EnemyInstance,
  PotionDef,
  RelicCondition,
  RelicTrigger,
  Statuses,
} from './types.js';
import { EngineError } from './types.js';
import {
  addStatus,
  applyEnemyEffect,
  applyPlayerEffect,
  drawCards,
  getStatus,
} from './effects.js';
import { resolveEnemyPool } from './enemyMoves.js';

export const HAND_SIZE = 5;
export const BASE_ENERGY = 3;

export function startCombat(
  content: ContentRegistry,
  deck: readonly string[],
  playerHp: number,
  playerMaxHp: number,
  relicIds: readonly string[],
  enemyIds: readonly string[],
  rng: Rng,
  enemyHpMult = 1,
): CombatState {
  const enemies: EnemyInstance[] = enemyIds.map((defId) => {
    const def = content.enemies[defId];
    if (!def) throw new EngineError(`unknown enemy ${defId}`);
    // Roll first (RNG stream unchanged), then scale — default mult 1 is a no-op.
    const hp = Math.max(1, Math.round(rng.intBetween(def.hp[0], def.hp[1]) * enemyHpMult));
    return {
      defId,
      name: def.name,
      hp,
      maxHp: hp,
      block: 0,
      statuses: {},
      nextMoveIndex: rng.int(def.moves.length),
    };
  });

  let combat: CombatState = {
    enemies,
    hand: [],
    drawPile: rng.shuffle(deck),
    discardPile: [],
    energy: BASE_ENERGY,
    maxEnergy: BASE_ENERGY,
    playerHp,
    playerMaxHp,
    playerBlock: 0,
    playerStatuses: {},
    turn: 1,
    dealt: 0,
    taken: 0,
    slain: 0,
  };

  combat = drawCards(combat, HAND_SIZE, rng);
  combat = applyRelics(content, combat, relicIds, 'combatStart', rng);
  return combat;
}

export function playCard(
  content: ContentRegistry,
  combat: CombatState,
  handIndex: number,
  targetIndex: number | undefined,
  rng: Rng,
  relicIds: readonly string[] = [],
): CombatState {
  const cardId = combat.hand[handIndex];
  if (cardId === undefined) throw new EngineError(`no card at hand index ${handIndex}`);
  const card = content.cards[cardId];
  if (!card) throw new EngineError(`unknown card ${cardId}`);
  if (card.cost > combat.energy) throw new EngineError(`not enough energy for ${card.name}`);
  if (card.target === 'enemy') {
    const enemy = combat.enemies[targetIndex ?? -1];
    if (!enemy || enemy.hp <= 0) {
      throw new EngineError(`${card.name} requires a living target`);
    }
  }

  // Snapshot which enemies are alive BEFORE the card resolves, so we can detect
  // exactly the kills caused by THIS card (alive-then-dead transitions).
  const wasAlive = combat.enemies.map((e) => e.hp > 0);

  let next: CombatState = {
    ...combat,
    energy: combat.energy - card.cost,
    hand: combat.hand.filter((_, i) => i !== handIndex),
    discardPile: [...combat.discardPile, cardId],
  };
  for (const effect of card.effects) {
    next = applyPlayerEffect(next, effect, targetIndex, rng);
  }

  // Relic triggers at the playCard chokepoint. These are NO-OPS (no rng, no
  // state change) when relicIds holds no relic with the matching trigger, so a
  // player whose relics are all combatStart/turnStart replays byte-identically.
  // Order: card effects → onKill (once per enemy this card killed) → onCardPlayed.
  for (let i = 0; i < next.enemies.length; i++) {
    const killedNow = wasAlive[i] === true && (next.enemies[i] as EnemyInstance).hp <= 0;
    if (killedNow) {
      next = applyRelics(content, next, relicIds, 'onKill', rng);
    }
  }
  next = applyRelics(content, next, relicIds, 'onCardPlayed', rng);
  return next;
}

/**
 * Apply a combat potion's effects. Mirrors playCard's validation/immutability:
 * enemy-target potions require a living target. Potions cost no energy and are
 * not cards, so there is nothing to discard — they are removed from the run's
 * satchel by the caller (run.ts).
 */
export function usePotion(
  potion: PotionDef,
  combat: CombatState,
  targetIndex: number | undefined,
  rng: Rng,
): CombatState {
  if (potion.target === 'enemy') {
    const enemy = combat.enemies[targetIndex ?? -1];
    if (!enemy || enemy.hp <= 0) {
      throw new EngineError(`${potion.name} requires a living target`);
    }
  }
  let next = combat;
  for (const effect of potion.effects) {
    next = applyPlayerEffect(next, effect, targetIndex, rng);
  }
  return next;
}

export function endTurn(
  content: ContentRegistry,
  combat: CombatState,
  rng: Rng,
): CombatState {
  // Discard hand.
  let next: CombatState = {
    ...combat,
    discardPile: [...combat.discardPile, ...combat.hand],
    hand: [],
  };

  // Enemy phase: each living enemy resets its block, then performs its
  // cycled move.
  for (let i = 0; i < next.enemies.length; i++) {
    const enemy = next.enemies[i] as EnemyInstance;
    if (enemy.hp <= 0) continue;
    const def = content.enemies[enemy.defId];
    if (!def) throw new EngineError(`unknown enemy ${enemy.defId}`);
    // Pick the active move pool ONCE per turn from current HP, execute that
    // move, and advance the index against THIS SAME pool length — so a phase
    // change can never desync the index from the pool (pure: no rng).
    const pool = resolveEnemyPool(def, enemy);
    const poolLen = pool.length;
    const move = poolLen > 0 ? pool[enemy.nextMoveIndex % poolLen] : undefined;
    if (!move) continue;
    next = {
      ...next,
      enemies: next.enemies.map((e, j) =>
        j === i
          ? { ...e, block: 0, nextMoveIndex: (e.nextMoveIndex + 1) % poolLen }
          : e,
      ),
    };
    for (const effect of move.effects) {
      next = applyEnemyEffect(next, i, effect);
      if (next.playerHp <= 0) return next;
    }
  }

  // Round end: poison damages (bypassing block), regen heals, timed statuses decay.
  const afterPoison = Math.max(0, next.playerHp - getStatus(next.playerStatuses, 'poison'));
  next = {
    ...next,
    playerHp: Math.min(
      next.playerMaxHp,
      afterPoison + getStatus(next.playerStatuses, 'regen'),
    ),
    playerStatuses: decayStatuses(next.playerStatuses),
    enemies: next.enemies.map((e) => {
      if (e.hp <= 0) return e;
      const poisoned = Math.max(0, e.hp - getStatus(e.statuses, 'poison'));
      return {
        ...e,
        hp: Math.min(e.maxHp, poisoned + getStatus(e.statuses, 'regen')),
        statuses: decayStatuses(e.statuses),
      };
    }),
  };

  // Next player turn: block resets, energy refills, draw a fresh hand.
  next = {
    ...next,
    turn: next.turn + 1,
    playerBlock: 0,
    energy: next.maxEnergy,
  };
  next = drawCards(next, HAND_SIZE, rng);
  return next;
}

export function isCombatWon(combat: CombatState): boolean {
  return combat.enemies.every((e) => e.hp <= 0);
}

export function isCombatLost(combat: CombatState): boolean {
  return combat.playerHp <= 0;
}

export function applyRelics(
  content: ContentRegistry,
  combat: CombatState,
  relicIds: readonly string[],
  trigger: RelicTrigger,
  rng: Rng,
): CombatState {
  let next = combat;
  for (const relicId of relicIds) {
    const relic = content.relics[relicId];
    if (!relic || relic.trigger !== trigger) continue;
    // Optional comeback gate: pure HP-fraction check, consumes no rng. A relic
    // whose condition fails applies nothing (so its rng-using effects don't run).
    if (relic.condition && !relicConditionMet(relic.condition, next)) continue;
    for (const effect of relic.effects) {
      next = applyPlayerEffect(next, effect, undefined, rng);
    }
  }
  return next;
}

/** Pure predicate for a relic's optional firing condition (reads HP only). */
function relicConditionMet(
  condition: RelicCondition,
  combat: CombatState,
): boolean {
  switch (condition.kind) {
    case 'hpBelow':
      return combat.playerMaxHp > 0 && combat.playerHp / combat.playerMaxHp < condition.pct / 100;
  }
}

function decayStatuses(statuses: Statuses): Statuses {
  // Only TIMED statuses decay at round end. PERMANENT powers — strength,
  // dexterity, and #68 `overcharge` — are intentionally NOT in this set, so they
  // persist for the whole fight (overcharge keeps converting overheat to Strength
  // every round, mirroring how strength/dexterity already stick around).
  let next = statuses;
  for (const id of ['vulnerable', 'weak', 'regen', 'poison'] as const) {
    if (getStatus(next, id) > 0) next = addStatus(next, id, -1);
  }
  return next;
}
