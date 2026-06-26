/**
 * Juice / feedback (V6): PURE-UI presentation helpers that turn the player's
 * LAST action into transient, snapshot-verifiable "beats" — a `-N` on the enemy
 * that was hit, a `DOWN` tag on one slain this action, a `+Nblk` when the
 * player's block rose, a `+Ng`/`+Nhp` when gold/HP rose.
 *
 * Why action-DERIVED (not a fading timer): our verification harness reads static
 * frames + presses keys, so a flash that fades on a wall-clock timer can never
 * be captured. Instead every beat is DERIVED by diffing the prior state against
 * the current state and PERSISTS until the next action changes state again, then
 * recomputes. A snapshot taken right after an action therefore SHOWS the beat.
 *
 * Purity: this module is read-only over engine state and returns plain data. It
 * never mutates state, never touches RNG/the wall clock, and never feeds back
 * into game logic — beats are ephemeral display only.
 */
import { useRef } from 'react';
import type { CombatState } from '../engine/types.js';

/**
 * Hold the value of `current` as it was BEFORE the most recent change, so a
 * caller can diff "what changed on the last action". Identity-based: each render
 * compares `current` to the value we last recorded; only when it DIFFERS (a new
 * action produced a new state object) do we advance — the previously-current
 * value becomes the new "prior", which then PERSISTS across re-renders until the
 * next change. This is the verifiable core of the juice model: beats derived
 * from this prior stay visible until the next action recomputes them.
 *
 * Returns `null` on the first render (no prior yet → callers show no beat) and
 * whenever `current` is null (e.g. combat ended → no stale combat beats).
 */
export function usePrevOnChange<T>(current: T): T | null {
  const prior = useRef<T | null>(null);
  const lastSeen = useRef<T | null>(null);
  if (current !== lastSeen.current) {
    prior.current = lastSeen.current;
    lastSeen.current = current;
  }
  return prior.current;
}

/** A transient damage/slain beat to render on one enemy row. */
export interface EnemyBeat {
  /** Positive HP lost by this enemy since the prior state (0 → no damage beat). */
  readonly damage: number;
  /** True iff this enemy was alive in the prior state and is dead now. */
  readonly slain: boolean;
}

/**
 * Diff the prior combat against the current one to derive a per-enemy beat,
 * indexed the same as `current.enemies` (stable indices — the reducer never
 * reorders or removes enemies, it zeroes their HP). Returns an empty array on
 * the first render (no prior) or when the enemy roster shape changed (combat
 * swapped out), so we never show a stale beat from a different fight.
 */
export function enemyBeats(
  prior: CombatState | null,
  current: CombatState,
): readonly EnemyBeat[] {
  if (!prior || prior.enemies.length !== current.enemies.length) return [];
  return current.enemies.map((now, i) => {
    const was = prior.enemies[i];
    if (!was) return { damage: 0, slain: false };
    const damage = Math.max(0, was.hp - now.hp);
    const slain = was.hp > 0 && now.hp <= 0;
    return { damage, slain };
  });
}
