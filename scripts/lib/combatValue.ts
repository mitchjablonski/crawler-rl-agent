/**
 * State-aware combat-value heuristic for the dev playtest harness (NOT shipped).
 *
 * Increment #57: the greedy harness combat policy was poison-BLIND. It iterated
 * card TYPES in a fixed order and played the first affordable card of each type,
 * never valuing poison, never timing a poison-payoff card, always targeting the
 * lowest-HP enemy. So apothecary's poison ramp (Venom Reprisal, Detonation Vial,
 * Tipped Blade, ...) was played randomly, which produced PHANTOM balance signals:
 * apothecary nightmare cells looked ~8-12pp behind knight under greedy while MCTS
 * (the arbiter) wins those cells ~1.0 (= knight). The gap was a greedy-policy
 * artifact, not a content gap.
 *
 * This module gives greedy a cheap, pure, deterministic, ONE-PLY estimate of how
 * good it is to PLAY a card right now against a chosen target. It is NOT a
 * lookahead / tree search — it values a single play against the CURRENT combat
 * state. The combat policy (playtest.ts) uses it to pick the best affordable play
 * each step, then repeat until no positive-value play remains.
 *
 * Key state-aware ideas (vs the static draft scorer in scoreCard.ts):
 *  - POISON is valued by its CUMULATIVE worth. Poison ticks its current value
 *    each round end, then decays by 1, so applying `s` stacks on an enemy that
 *    already has `p` deals (over the poison's life) f(p+s) - f(p) where
 *    f(q)=q(q+1)/2 — i.e. each stack is worth more when more poison is already
 *    down. Capped at the enemy's HP (poison can't kill more than it has). This is
 *    why a competent player stacks poison early and on the same target.
 *  - CONDITIONAL poison-payoff cards (`conditional` w/ `targetHasStatus`) are
 *    valued through the REAL predicate against the chosen target: the `then`
 *    branch counts only when the target ACTUALLY meets the threshold (so the bot
 *    "detonates" Detonation Vial at >=5 poison, Venom Reprisal at >=1), else only
 *    the cold base counts.
 *  - DAMAGE uses the engine's own attackDamage (strength/weak/vulnerable) and is
 *    capped at target HP so overkill isn't over-valued.
 *
 * Pure & deterministic: reads only the combat state + the closed Effect set, no
 * rng, no clock, no mutation. Tooling-only.
 */
import { attackDamage, getStatus } from '../../src/engine/effects.js';
import { resolveEnemyMove } from '../../src/engine/enemyMoves.js';
import type {
  CardDef,
  CombatState,
  ContentRegistry,
  Effect,
  EffectCondition,
  Statuses,
  TargetKind,
} from '../../src/engine/types.js';

/** Each point of immediate (or poison) damage is worth this. */
const DAMAGE_VALUE = 1.0;
/** Block is defensive: discounted under an offensive (greedy/attack) lean. */
const BLOCK_WEIGHT_ATTACK = 0.5;
/** Under a defensive (cautious/block) lean, block is worth more than offense. */
const BLOCK_WEIGHT_BLOCK = 1.15;
/** A point of block that PREVENTS incoming damage saves ~a point of HP. */
const BLOCK_PREVENT = 1.0;
/** Block beyond this turn's incoming threat is mostly wasted (decays unused). */
const BLOCK_OVERFLOW = 0.2;
/** Drawing a card replaces itself + digs — modest tempo value. */
const DRAW_VALUE = 1.6;
/** +1 energy refunds a play; ~a strong card's worth of future tempo. */
const ENERGY_VALUE = 3.5;
/** In-combat heal is weak vs block; capped at missing HP. */
const HEAL_VALUE = 0.4;
/** Poison damage is delayed (slightly discounted vs immediate) but bypasses block. */
const POISON_WEIGHT = 0.95;
/**
 * Flat bonus when a damage effect is LETHAL to its target. Removing an attacker
 * prevents its future damage, which is worth more than the few HP of "overkill"
 * the HP cap discards — so a killing blow on a low-HP enemy beats chipping a
 * full-HP tank. This restores the focus-fire the old policy got from always
 * targeting the lowest-HP enemy (critical in multi-enemy arc fights).
 */
const KILL_BONUS = 6;

/**
 * Per-stack value of the non-poison statuses (poison has its own cumulative
 * model). Scaling buffs (strength/dexterity) are worth more than timed debuffs.
 */
const STATUS_VALUE: Record<string, number> = {
  strength: 4.0,
  dexterity: 2.0,
  regen: 2.0,
  vulnerable: 2.0,
  weak: 1.5,
  // #68 overcharge: a permanent power that grants Strength on every future
  // overheat. Worth a bit less per stack than raw strength (its payoff is gated on
  // actually overheating again), but enough that the bot plays overdrive-core when
  // it still has overheat cards to fire — and the per-overheat Strength is then
  // credited on each loseHp play below.
  overcharge: 3.5,
};

/** Cumulative poison damage over its decaying life: f(q) = q(q+1)/2. */
function poisonLifetime(stacks: number): number {
  return (stacks * (stacks + 1)) / 2;
}

/**
 * #63 overheat gradient: the bonus a damage/block amount gains from the player's
 * CURRENT missing HP — `floor((maxHp - hp) / divisor)`. Mirrors the engine's
 * missingHpBonus (effects.ts) so greedy values gradient cards against the REAL
 * state. Pure; 0 when absent or at full HP.
 */
function missingHpBonus(combat: CombatState, divisor: number | undefined): number {
  if (divisor === undefined) return 0;
  return Math.floor((combat.playerMaxHp - combat.playerHp) / divisor);
}

/**
 * #63 overheat: per-HP value of `loseHp`, a self-cost that FLOORS at 1 (never
 * lethal). It is risk, not board impact, so a small negative — enough that the
 * bot doesn't overheat for free, but it still plays the strong tempo it buys.
 */
const LOSE_HP_VALUE = -0.5;

/** Indices of living enemies an effect of `target` would hit (self -> []). */
function targetIndices(
  combat: CombatState,
  target: TargetKind,
  targetIndex: number | undefined,
): number[] {
  if (target === 'self') return [];
  if (target === 'allEnemies') {
    const out: number[] = [];
    combat.enemies.forEach((e, i) => {
      if (e.hp > 0) out.push(i);
    });
    return out;
  }
  // single 'enemy'
  if (targetIndex === undefined) return [];
  const e = combat.enemies[targetIndex];
  return e && e.hp > 0 ? [targetIndex] : [];
}

/**
 * Evaluate a conditional predicate against the current state + selected target.
 * Mirrors the engine's evalCondition (effects.ts) — kept pure/local so the helper
 * does not depend on an engine internal. Reads only state, draws no rng.
 */
function conditionHolds(
  combat: CombatState,
  condition: EffectCondition,
  targetIndex: number | undefined,
): boolean {
  switch (condition.type) {
    case 'targetHasStatus': {
      const need = condition.atLeast ?? 1;
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

/**
 * Total damage the LIVING enemies will deal to the player on their next turn,
 * from their currently-telegraphed moves (resolveEnemyMove — the same intent the
 * combat UI shows). Accounts for strength/weak (attacker) and vulnerable (the
 * player) via the engine's attackDamage. Pure: reads only state + static content.
 * Used to value block by what it actually PREVENTS, so the bot blocks against big
 * hits and doesn't waste block when little is incoming (skilled play, one-ply).
 */
export function predictIncomingDamage(combat: CombatState, content: ContentRegistry): number {
  let total = 0;
  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = content.enemies[e.defId];
    if (!def) continue;
    const move = resolveEnemyMove(def, e);
    if (!move) continue;
    for (const eff of move.effects) {
      // In enemy moves, target 'enemy' means the player.
      if (eff.kind === 'damage' && eff.target === 'enemy') {
        const times = eff.times ?? 1;
        total += attackDamage(eff.amount, e.statuses, combat.playerStatuses) * times;
      }
    }
  }
  return total;
}

function effectValue(
  combat: CombatState,
  effect: Effect,
  targetIndex: number | undefined,
  blockWeight: number,
  incoming: number,
): number {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times ?? 1;
      // #63: the missing-HP gradient lifts the per-hit base, exactly like the engine.
      const base = effect.amount + missingHpBonus(combat, effect.scaleMissingHp);
      let total = 0;
      for (const i of targetIndices(combat, effect.target, targetIndex)) {
        const e = combat.enemies[i];
        if (!e) continue;
        const perHit = attackDamage(base, combat.playerStatuses, e.statuses);
        const raw = perHit * times;
        total += Math.min(raw, e.hp) * DAMAGE_VALUE;
        if (raw >= e.hp && e.hp > 0) total += KILL_BONUS; // securing a kill
      }
      return total;
    }
    case 'loseHp': {
      // #63 overheat: an unblockable self-cost (floors at 1) — a small negative.
      // #68: if the player is OVERCHARGED, this overheat ALSO grants that many
      // Strength (engine loseHp hook), so credit it at the strength rate — this is
      // why an overcharged Overclocker happily keeps overheating.
      const overcharge = getStatus(combat.playerStatuses, 'overcharge');
      const overchargeGain = overcharge * (STATUS_VALUE.strength ?? 4.0);
      return effect.amount * LOSE_HP_VALUE + overchargeGain;
    }
    case 'block': {
      const amt = Math.max(
        0,
        // #63: the gradient lifts block before dexterity, like the engine.
        effect.amount +
          missingHpBonus(combat, effect.scaleMissingHp) +
          getStatus(combat.playerStatuses, 'dexterity'),
      );
      // Value the block that PREVENTS this turn's remaining incoming damage at
      // ~HP rates; the overflow (beyond the threat) is mostly wasted and only
      // matters under a defensive (block) lean.
      const threat = Math.max(0, incoming - combat.playerBlock);
      const prevented = Math.min(amt, threat);
      const overflow = amt - prevented;
      return prevented * BLOCK_PREVENT + overflow * BLOCK_OVERFLOW * blockWeight;
    }
    case 'draw':
      return effect.count * DRAW_VALUE;
    case 'gainEnergy':
      return effect.amount * ENERGY_VALUE;
    case 'heal': {
      const missing = Math.max(0, combat.playerMaxHp - combat.playerHp);
      return Math.min(effect.amount, missing) * HEAL_VALUE;
    }
    case 'applyStatus': {
      if (effect.status === 'poison') {
        let total = 0;
        for (const i of targetIndices(combat, effect.target, targetIndex)) {
          const e = combat.enemies[i];
          if (!e) continue;
          const have = getStatus(e.statuses, 'poison');
          const marginal = poisonLifetime(have + effect.stacks) - poisonLifetime(have);
          // Poison can't remove more HP than the enemy has.
          total += Math.min(marginal, e.hp) * POISON_WEIGHT;
        }
        return total;
      }
      const per = STATUS_VALUE[effect.status] ?? 1.0;
      if (effect.target === 'self') return effect.stacks * per;
      const targets = targetIndices(combat, effect.target, targetIndex);
      return targets.length * effect.stacks * per;
    }
    case 'conditional': {
      const branch = conditionHolds(combat, effect.condition, targetIndex)
        ? effect.then
        : (effect.else ?? []);
      let total = 0;
      for (const inner of branch)
        total += effectValue(combat, inner, targetIndex, blockWeight, incoming);
      return total;
    }
  }
}

export interface CombatValueOpts {
  /** 'attack' (greedy) discounts overflow block; 'block' (cautious) values it up. */
  readonly prefer?: 'attack' | 'block';
  /**
   * Predicted incoming damage this turn (from {@link predictIncomingDamage}).
   * Block is valued by what it PREVENTS of this threat. Defaults to 0 (so block
   * is treated as pure overflow when the caller can't predict — conservative).
   */
  readonly incoming?: number;
}

/**
 * The one-ply value of playing `card` against `targetIndex` in `combat`. Higher
 * is better; pure & deterministic. For single-target cards `targetIndex` selects
 * the enemy; for self/allEnemies cards it is ignored (pass undefined).
 */
export function combatValue(
  card: CardDef,
  combat: CombatState,
  targetIndex: number | undefined,
  opts: CombatValueOpts = {},
): number {
  const blockWeight = opts.prefer === 'block' ? BLOCK_WEIGHT_BLOCK : BLOCK_WEIGHT_ATTACK;
  const incoming = opts.incoming ?? 0;
  let total = 0;
  for (const e of card.effects)
    total += effectValue(combat, e, targetIndex, blockWeight, incoming);
  return total;
}

/** Exposed for callers that need to know the cumulative poison model (tests). */
export function poisonLifetimeValue(have: number, add: number): number {
  return poisonLifetime(have + add) - poisonLifetime(have);
}

/** Re-export to let the policy read poison without importing the engine twice. */
export function enemyPoison(statuses: Statuses): number {
  return getStatus(statuses, 'poison');
}
