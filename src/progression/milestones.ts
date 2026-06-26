import type { MetaState, RunRecord } from '../persistence/saves.js';

/**
 * Meta-progression (E2). Cross-run UNLOCKS are DERIVED purely from the run
 * history (`MetaState.runs`) — there is no separate "unlocked" save field to
 * drift or corrupt. Unlocks only ever ADD content; the core balanced pool is
 * always available. A milestone names the set of EXTRA card/relic ids it grants;
 * content marks those ids via the `unlock` flag (see UNLOCKABLE_*_IDS).
 *
 * Milestone ids here MUST match the `unlock` strings authored on the new
 * cards/relics in content. `deriveUnlocks` is a pure function of meta: same
 * history → same unlock set, so the Title can diff before/after a run.
 */
export const MILESTONES = {
  /** Beat the boss for the first time (any difficulty/mode/character). */
  FIRST_VICTORY: 'first-victory',
  /** Beat the boss on Hard or Nightmare. */
  HARD_VICTORY: 'hard-victory',
  /** Win a multi-act arc run. */
  ARC_VICTORY: 'arc-victory',
  /** Accumulate three boss victories in total. */
  THREE_VICTORIES: 'three-victories',
} as const;

export type MilestoneId = (typeof MILESTONES)[keyof typeof MILESTONES];

/** Difficulties that count as "hard+" for the hard-victory milestone. */
const HARD_PLUS = new Set(['hard', 'nightmare']);

/** A run record counts as a victory iff its boss was beaten. */
const isVictory = (r: RunRecord): boolean => r.outcome === 'victory';

/**
 * Each milestone is a predicate over the full run history plus the ordered list
 * of EXTRA content ids it grants. The ids must be marked with the matching
 * `unlock` flag in content so the gate excludes them until earned.
 *
 * Old records lacking `difficulty`/`mode` simply don't match the gated
 * milestones (graceful: an undefined field is never in HARD_PLUS / never 'arc').
 */
interface MilestoneRule {
  readonly id: MilestoneId;
  readonly met: (runs: readonly RunRecord[]) => boolean;
  readonly grants: readonly string[];
}

export const MILESTONE_RULES: readonly MilestoneRule[] = [
  {
    id: MILESTONES.FIRST_VICTORY,
    met: (runs) => runs.some(isVictory),
    grants: ['heroic-second-wind', 'crawlers-resolve'],
  },
  {
    id: MILESTONES.HARD_VICTORY,
    met: (runs) =>
      runs.some((r) => isVictory(r) && r.difficulty !== undefined && HARD_PLUS.has(r.difficulty)),
    grants: ['hard-won-medallion', 'hard-won-strike'],
  },
  {
    id: MILESTONES.ARC_VICTORY,
    met: (runs) => runs.some((r) => isVictory(r) && r.mode === 'arc'),
    grants: ['arc-warden'],
  },
  {
    id: MILESTONES.THREE_VICTORIES,
    met: (runs) => runs.filter(isVictory).length >= 3,
    grants: ['veterans-edge', 'trophy-rack', 'veterans-banner'],
  },
];

/** Every id that ANY milestone can grant (the full set of extra content ids). */
export const ALL_UNLOCKABLE_IDS: ReadonlySet<string> = new Set(
  MILESTONE_RULES.flatMap((m) => m.grants),
);

/**
 * Derive the set of unlocked EXTRA content ids from run history. Pure: no runs
 * → empty set; otherwise the union of every met milestone's grants. The result
 * is the ALLOW set passed into the draft gate (locked = unlockable \ allowed).
 */
export function deriveUnlocks(meta: MetaState): ReadonlySet<string> {
  const unlocked = new Set<string>();
  for (const rule of MILESTONE_RULES) {
    if (rule.met(meta.runs)) for (const id of rule.grants) unlocked.add(id);
  }
  return unlocked;
}
