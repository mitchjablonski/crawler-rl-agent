import type { EnemyDef, EnemyInstance, EnemyMove } from './types.js';

/**
 * Pick the active move pool for an enemy from its CURRENT HP fraction.
 *
 * Ordering/selection rule: `def.phases` is ordered ASCENDING by `hpThreshold`
 * (a fraction in (0, 1]). The active pool is the FIRST phase whose
 * `hpThreshold >= hp/maxHp` — i.e. the most-damaged phase that still applies.
 * If no phase matches (or there are none), the base `def.moves` are used.
 *
 * This is a PURE function of HP — no rng — so the pool for a phaseless enemy is
 * always exactly `def.moves` and replays stay byte-identical.
 */
export function resolveEnemyPool(def: EnemyDef, enemy: EnemyInstance): readonly EnemyMove[] {
  const phases = def.phases;
  if (!phases || phases.length === 0) return def.moves;
  // Guard against a degenerate maxHp; treat as full health.
  const ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
  for (const phase of phases) {
    if (phase.hpThreshold >= ratio) return phase.moves;
  }
  return def.moves;
}

/**
 * The concrete move an enemy will perform this turn: the active phase pool (by
 * current HP) indexed by `nextMoveIndex`. For phaseless enemies this returns
 * exactly `def.moves[nextMoveIndex % def.moves.length]` (byte-identical to the
 * pre-phase behavior). Used by BOTH the combat reducer (to execute the move)
 * and the combat UI (to telegraph intent), so the telegraph always matches the
 * move that actually fires once the boss changes phase.
 */
export function resolveEnemyMove(def: EnemyDef, enemy: EnemyInstance): EnemyMove | undefined {
  const pool = resolveEnemyPool(def, enemy);
  if (pool.length === 0) return undefined;
  return pool[enemy.nextMoveIndex % pool.length];
}
