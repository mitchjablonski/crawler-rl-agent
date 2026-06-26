import type { GameEvent, GameEventKind } from '../events/types.js';
import type { Modifier } from '../engine/modifiers.js';
import type { SnarkLevel } from '../config.js';
import type { BucketConfig } from './limiter.js';

export interface RuleOutcome {
  readonly modifier: Modifier | null;
  /** Static flavor line; the Dungeon AI may re-word it, never change the mechanics. */
  readonly narration: string | null;
}

const NONE: RuleOutcome = { modifier: null, narration: null };

type Lines = Readonly<Record<SnarkLevel, string>>;

const pick = (lines: Lines, snark: SnarkLevel) => lines[snark];

export function ruleFor(event: GameEvent, snark: SnarkLevel = 1): RuleOutcome {
  switch (event.kind) {
    case 'tests_passed':
      return {
        modifier: { kind: 'lootRoll', size: 'big' },
        narration: pick(
          {
            0: 'Tests passed. The dungeon dispenses gold.',
            1: 'Tests passed. The dungeon, disgusted by competence, tosses you a coin purse.',
            2: 'Your tests PASSED? The dungeon pays out, visibly furious, and files a complaint.',
          },
          snark,
        ),
      };
    case 'build_passed':
      return {
        modifier: { kind: 'lootRoll', size: 'small' },
        narration: pick(
          {
            0: 'Build succeeded. Some gold falls.',
            1: 'The build stands. Loose coins rattle down from the ceiling.',
            2: 'It compiles. The dungeon flings coins at you like an insult. Keep the day job.',
          },
          snark,
        ),
      };
    case 'tests_failed':
      return {
        modifier: { kind: 'queueElite', enemyId: 'lint-goblin' },
        narration: pick(
          {
            0: 'Tests failed. An elite approaches.',
            1: 'Something failed above. A Lint Goblin has caught your scent.',
            2: 'Tests failing already? The Lint Goblin smells blood. It sides with the test runner.',
          },
          snark,
        ),
      };
    case 'build_failed':
      return {
        modifier: { kind: 'queueElite', enemyId: 'lint-goblin' },
        narration: pick(
          {
            0: 'Build failed. An elite approaches.',
            1: 'The build collapsed. A Lint Goblin crawls out of the rubble.',
            2: 'The build is rubble and a Lint Goblin is moving in. It says your code signed the deed.',
          },
          snark,
        ),
      };
    case 'lint_failed':
      return {
        modifier: { kind: 'queueElite', enemyId: 'lint-goblin' },
        narration: pick(
          {
            0: 'Lint failed. An elite approaches.',
            1: 'The linter flagged you. The Lint Goblin straightens its glasses and stands up.',
            2: 'Lint errors? The Lint Goblin was BORN for this. It cracks its knuckles and cites the style guide.',
          },
          snark,
        ),
      };
    case 'lint_passed':
      return {
        modifier: { kind: 'lootRoll', size: 'small' },
        narration: pick(
          {
            0: 'Lint passed. Minor gold.',
            1: 'Clean code, clean conscience. A few tidy coins clink down.',
            2: 'No lint errors? Show-off. The dungeon flips you a coin and tells you not to get used to it.',
          },
          snark,
        ),
      };
    case 'committed':
      return {
        modifier: { kind: 'healPlayer', amount: 5 },
        narration: pick(
          {
            0: 'Committed. +5 HP checkpoint.',
            1: 'You saved your progress. The dungeon bookmarks your soul. +5 HP.',
            2: 'A commit? Brave, given that history. The dungeon stitches you up at the checkpoint anyway. +5 HP.',
          },
          snark,
        ),
      };
    case 'pushed':
      return {
        modifier: { kind: 'blessNextCombat', status: 'strength', stacks: 1 },
        narration: pick(
          {
            0: 'Pushed. +1 Strength next combat.',
            1: 'You shipped it. The dungeon braces for the regressions; you carry the swagger. +1 Strength next combat.',
            2: 'You PUSHED that? To main, no less. The dungeon respects the audacity and hands you +1 Strength for the fight that cleans up after you.',
          },
          snark,
        ),
      };
    case 'agent_spawned':
      return {
        modifier: { kind: 'blessNextCombat', status: 'strength', stacks: 1 },
        narration: pick(
          {
            0: '+1 Strength next combat.',
            1: 'A familiar joins the hunt. +1 Strength next combat.',
            2: 'Summoning help? Adorable. Fine: +1 Strength, since you clearly cannot do this alone.',
          },
          snark,
        ),
      };
    case 'session_started':
      return {
        modifier: { kind: 'healPlayer', amount: 10 },
        narration: pick(
          {
            0: 'Session started. +10 HP.',
            1: 'The dungeon stirs awake. You feel slightly less terrible.',
            2: 'The dungeon wakes, sighs at your return, and heals you out of pity. +10 HP.',
          },
          snark,
        ),
      };
    case 'code_changed': {
      const where = event.detail ? ` (${event.detail})` : '';
      return {
        modifier: { kind: 'lootRoll', size: 'small' },
        narration: pick(
          {
            0: `Code changed${where}. Minor gold.`,
            1: `Progress echoes from above${where}. A few coins skitter down.`,
            2: `Someone touched${where || ' the code'} and lived. The dungeon tips you for the show.`,
          },
          snark,
        ),
      };
    }
    // Pause flow, not modifiers:
    case 'claude_awaits_user':
    case 'attention_required':
    case 'review_requested':
      return NONE;
    // Ambience only:
    case 'file_explored':
    case 'activity':
      return NONE;
  }
}

const DEFAULT_LIMIT: BucketConfig = { capacity: 3, refillPerMinute: 1 };

const LIMITS: Partial<Record<GameEventKind, BucketConfig>> = {
  // Edits fire constantly during real work; keep the coin trickle a trickle.
  code_changed: { capacity: 2, refillPerMinute: 0.5 },
  tests_passed: { capacity: 2, refillPerMinute: 1 },
  build_passed: { capacity: 2, refillPerMinute: 1 },
  // At most 2 goblins can be queued anyway (engine cap); don't burn tokens.
  tests_failed: { capacity: 2, refillPerMinute: 0.5 },
  build_failed: { capacity: 2, refillPerMinute: 0.5 },
  // Linters run constantly (often on save); keep both directions tight.
  lint_passed: { capacity: 1, refillPerMinute: 0.5 },
  lint_failed: { capacity: 2, refillPerMinute: 0.5 },
  // Commits are deliberate but can come in bursts; modest checkpoint heals.
  committed: { capacity: 2, refillPerMinute: 0.5 },
  // A push is the rarest, most deliberate signal; one celebratory bless at a
  // time, refilling slowly so a CI retry storm can't farm Strength.
  pushed: { capacity: 1, refillPerMinute: 0.25 },
  agent_spawned: { capacity: 1, refillPerMinute: 1 },
  session_started: { capacity: 1, refillPerMinute: 0.2 },
};

export function limitFor(kind: string): BucketConfig {
  return LIMITS[kind as GameEventKind] ?? DEFAULT_LIMIT;
}
