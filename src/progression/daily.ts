import type { Difficulty, RunMode } from '../config.js';
import type { RunState } from '../engine/types.js';
import type { MetaState } from '../persistence/saves.js';

/**
 * Daily Challenge (E3). A deterministic "seed of the day" everyone shares, with
 * a pure SCORE summary, for replayability and comparison.
 *
 * Purity: this module is pure given its inputs. The date is the only ambient,
 * non-deterministic ingredient, and it is INJECTED as a millisecond timestamp
 * (`dailySeed(nowMs)`) — never read from the wall clock here. The UI layer
 * passes the existing injected `now()` clock. The project bans `Date.now()` /
 * `new Date()` in the engine; this lives in the progression/UI layer and still
 * takes the timestamp as an argument so it stays a pure function.
 */

/**
 * Canonical daily configuration. The daily FIXES the config so everyone plays
 * the IDENTICAL run and scores are directly comparable (fair leaderboard). It is
 * deliberately the baseline: normal difficulty, single-session mode, the default
 * knight class. (Changing these would fork the shared run, so they are constant.)
 */
export const DAILY_DIFFICULTY: Difficulty = 'normal';
export const DAILY_MODE: RunMode = 'single';
export const DAILY_CHARACTER = 'knight';

/** Zero-pad a number to two digits (UTC date parts). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * The UTC calendar date of a timestamp, as `YYYY-MM-DD`. Uses UTC so the daily
 * rolls over at the same instant for every player regardless of timezone (fair
 * comparison). Pure: derived entirely from the passed millisecond timestamp.
 */
export function dailyDate(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * The shared seed for the daily of a given timestamp: `daily-YYYY-MM-DD` (UTC).
 * Same day → same seed → identical run for everyone (the seed fully determines
 * the run together with the canonical config). Different day → different seed.
 */
export function dailySeed(nowMs: number): string {
  return `daily-${dailyDate(nowMs)}`;
}

/**
 * Score of a FINISHED daily run, derived purely from the final {@link RunState}.
 * Deterministic — reads only state, consumes no rng and no clock; it is NOT part
 * of the seeded run (no engine change), just a derivation over the result.
 *
 * Formula:  floorsCleared*50 + gold + endHp + relics*25 + (won ? 500 : 0)
 *   - floorsCleared = the depth (map row) of the node the run ended on, so
 *     deeper runs always outscore shallower ones.
 *   - gold / endHp reward surviving rich and healthy (more = higher).
 *   - relics*25 rewards build investment.
 *   - the flat +500 victory bonus is larger than any single same-depth swing in
 *     the other terms could plausibly close, so a VICTORY always outscores an
 *     otherwise-equal DEFEAT at the same depth (monotonic: winning > losing).
 *
 * All terms are non-negative and monotonic in the player's favor, so the score
 * never penalizes doing better.
 */
export function dailyScore(state: RunState): number {
  const floorsCleared = state.map.nodes[state.currentNodeId]?.row ?? 0;
  const won = state.phase === 'victory';
  return (
    floorsCleared * 50 +
    // Gold is weighted (not 1:1) so a no-shop hoard can't rival a build that
    // spent its gold and won — still strictly monotonic in gold, just lighter.
    Math.floor(Math.max(0, state.gold) * 0.5) +
    Math.max(0, state.hp) +
    state.relics.length * 25 +
    (won ? 500 : 0)
  );
}

/**
 * Best (max) daily score among recorded runs tagged with `daily === date`.
 * Returns undefined when no daily for that date has been recorded yet. Records
 * without a `score` are ignored (they cannot contribute to a best). Pure over
 * the passed meta.
 */
export function bestDailyScore(meta: MetaState, date: string): number | undefined {
  let best: number | undefined;
  for (const r of meta.runs) {
    if (r.daily === date && typeof r.score === 'number') {
      if (best === undefined || r.score > best) best = r.score;
    }
  }
  return best;
}

/**
 * General run score (#28): the same pure, monotonic derivation as
 * {@link dailyScore}, applied to ANY finished run so every run gets a comparable
 * SCORE for the personal-best chase. It deliberately REUSES the daily formula
 * (floors*50 + floor(gold*0.5) + endHp + relics*25 + win bonus) so daily and
 * non-daily scores live on one scale and a single recorded `score` field serves
 * both. Pure: reads only state, no rng, no clock; monotonic in the player's
 * favor (deeper / richer / healthier / more relics / a win never scores lower).
 *
 * NOTE: not folding #25 `state.stats` in here — those are useful flavor on the
 * run report, but keeping the score to the four durable end-state quantities
 * keeps it simple, obviously monotonic, and identical to the shipped daily scale.
 */
export function runScore(state: RunState): number {
  return dailyScore(state);
}

/**
 * Personal best (#28): the max recorded {@link runScore} among PRIOR runs that
 * match a (character, mode) — the chase target shown on GameOver. Returns null
 * when no matching prior run carries a score (a first run / a record run).
 *
 * Matching: a record matches when its `character` and `mode` equal the query.
 * Pre-E2 records lack these fields (undefined) so they only match an undefined
 * query — i.e. they never masquerade as a different (character, mode). Records
 * without a numeric `score` (pre-#28 history) are ignored and so never count as
 * a best — exactly the "migrates, doesn't wipe, doesn't fake a best" behavior.
 *
 * IMPORTANT: pass the meta as it was BEFORE this run was appended, so "NEW BEST"
 * compares against the PRIOR best and a record run correctly reads as a new best.
 * Pure over the passed meta.
 */
export function bestRun(
  meta: MetaState,
  query: { readonly character?: string; readonly mode?: RunMode },
): number | null {
  let best: number | null = null;
  for (const r of meta.runs) {
    if (r.character !== query.character || r.mode !== query.mode) continue;
    if (typeof r.score !== 'number') continue;
    if (best === null || r.score > best) best = r.score;
  }
  return best;
}
