import os from 'node:os';
import path from 'node:path';

export type SnarkLevel = 0 | 1 | 2;
export type AiProvider = 'anthropic' | 'claude-cli' | 'openai-compat' | 'static';
export type Difficulty = 'story' | 'normal' | 'hard' | 'nightmare';

export const DIFFICULTIES: readonly Difficulty[] = ['story', 'normal', 'hard', 'nightmare'];
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export type RunMode = 'single' | 'arc';

export const RUN_MODES: readonly RunMode[] = ['single', 'arc'];
export const DEFAULT_RUN_MODE: RunMode = 'single';
export const ARC_ACTS = 3;

/** Acts in a run for a given mode (single session vs multi-act arc). */
export function actsForMode(mode: RunMode): number {
  return mode === 'arc' ? ARC_ACTS : 1;
}

export interface DifficultyKnobs {
  readonly maxHp: number;
  readonly enemyHpMult: number;
  readonly startingGold: number;
  /**
   * Arc-only per-act enemy-HP ramp indexed by act (index 0 is always 1.0 so
   * single mode stays byte-identical). Undefined for single mode → no ramp.
   */
  readonly actHpRamp?: readonly number[];
  /**
   * Multiplier applied to event `loseHp` outcome amounts so risk branches bite
   * at higher difficulty (#34). MUST be exactly 1.0 on normal/story so seeded
   * normal replay stays byte-identical (the scalar only touches the resolved
   * amount, never the rng stream). Same per (difficulty) in both modes.
   */
  readonly eventLoseHpMult: number;
}

/**
 * Event `loseHp` scalar per difficulty (#34). normal/story are exactly 1.0 so
 * normal seeded replay is byte-identical; hard/nightmare add teeth to the
 * "risky" event branches that were toothless at hard+ in playtest.
 */
const EVENT_LOSE_HP_MULT: Readonly<Record<Difficulty, number>> = {
  story: 1.0,
  normal: 1.0,
  hard: 1.25,
  nightmare: 1.5,
};

/** Single-mode per-tier knobs (greedy: story ~84 / normal ~67 / hard ~41 / nightmare ~23). */
export const DIFFICULTY_KNOBS: Readonly<Record<Difficulty, DifficultyKnobs>> = {
  story: { maxHp: 70, enemyHpMult: 0.85, startingGold: 50, eventLoseHpMult: EVENT_LOSE_HP_MULT.story },
  normal: { maxHp: 70, enemyHpMult: 1.0, startingGold: 50, eventLoseHpMult: EVENT_LOSE_HP_MULT.normal },
  hard: { maxHp: 70, enemyHpMult: 1.18, startingGold: 50, eventLoseHpMult: EVENT_LOSE_HP_MULT.hard },
  nightmare: { maxHp: 70, enemyHpMult: 1.33, startingGold: 50, eventLoseHpMult: EVENT_LOSE_HP_MULT.nightmare },
};

/**
 * Arc base enemy-HP multiplier (act 0). Arc adds two more acts of rewards, and
 * the old flat bump left later acts too soft (players ended arcs far healthier
 * than single). Act 0 now sits close to single, and the per-act ramp below does
 * the difficulty work so the LATER acts — where arc players were over-healthy —
 * are the parts that bite. Swept to match single's greedy win-rate bands per
 * tier for both characters (see ARC_ACT_HP_RAMP).
 */
const ARC_ENEMY_HP_MULT: Readonly<Record<Difficulty, number>> = {
  story: 0.74,
  normal: 0.96,
  hard: 1.15,
  nightmare: 1.43,
};

/**
 * Arc per-act enemy-HP ramp, multiplied onto ARC_ENEMY_HP_MULT for combats in
 * that act. Index 0 is ALWAYS 1.0 (act 0 == base mult) so single mode (act 0
 * only) is byte-identical; acts 1 and 2 escalate so deeper acts are meaningfully
 * harder and arc players stop ending vastly healthier than single players.
 */
const ARC_ACT_HP_RAMP: Readonly<Record<Difficulty, readonly number[]>> = {
  story: [1.0, 1.1, 1.22],
  // normal/hard/nightmare intentionally share one ramp shape — the per-tier
  // difficulty is carried by ARC_ENEMY_HP_MULT (the base), not the ramp. Story
  // ramps gentler so its already-low base doesn't over-soften late acts.
  normal: [1.0, 1.13, 1.27],
  hard: [1.0, 1.13, 1.27],
  nightmare: [1.0, 1.13, 1.27],
};

/** Difficulty knobs for a (difficulty, mode) pair so a tier means the same challenge in both modes. */
export function knobsFor(difficulty: Difficulty, mode: RunMode): DifficultyKnobs {
  const base = DIFFICULTY_KNOBS[difficulty];
  return mode === 'arc'
    ? { ...base, enemyHpMult: ARC_ENEMY_HP_MULT[difficulty], actHpRamp: ARC_ACT_HP_RAMP[difficulty] }
    : base;
}

export interface Config {
  readonly saveDir: string;
  readonly seed: string | undefined;
  /** Explicit flag/env snark; undefined → fall back to the in-game setting, then wry. */
  readonly snarkLevel: SnarkLevel | undefined;
  readonly apiKey: string | undefined;
  /** Explicit backend choice; undefined → auto-resolve the provider ladder. */
  readonly aiProvider: AiProvider | undefined;
  readonly aiBaseUrl: string | undefined;
  readonly aiModel: string | undefined;
  readonly aiBudgetUsd: number;
  readonly aiTranscript: boolean;
  /** Hours before an unfinished run retires as abandoned (REQ-12). */
  readonly runTtlHours: number;
  /** Explicit flag/env difficulty; undefined → in-game setting, then Normal. */
  readonly difficulty: Difficulty | undefined;
  /** Explicit flag/env run mode; undefined → in-game setting, then single. */
  readonly runMode: RunMode | undefined;
  /** Explicit flag/env character id (validated by the UI); undefined → setting, then default. */
  readonly character: string | undefined;
}

/** Injectable ambient sources; production callers pass nothing. */
export interface ConfigSources {
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homedir?: string;
}

const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'claude-cli', 'openai-compat', 'static'];

/**
 * The ONLY place ambient configuration (argv, env, homedir) is ever read.
 * Precedence: CLI flags > env vars > defaults. Result is frozen (REQ-11).
 */
export function resolveConfig(sources: ConfigSources = {}): Config {
  const argv = sources.argv ?? process.argv.slice(2);
  const env = sources.env ?? process.env;
  const home = sources.homedir ?? os.homedir();
  const flags = parseFlags(argv);

  const saveDir =
    flags['save-dir'] ?? env['CCC_SAVE_DIR'] ?? path.join(home, '.claude-code-crawler');
  const seed = flags['seed'] ?? env['CCC_SEED'];

  const snarkRaw = flags['snark'] ?? env['CCC_SNARK'];
  const snarkNum = snarkRaw === undefined ? undefined : Number(snarkRaw);
  const snarkLevel: SnarkLevel | undefined =
    snarkNum === 0 || snarkNum === 1 || snarkNum === 2 ? snarkNum : undefined;

  const apiKey = flags['api-key'] ?? env['CCC_API_KEY'] ?? env['ANTHROPIC_API_KEY'];

  const providerRaw = flags['ai-provider'] ?? env['CCC_AI_PROVIDER'];
  const aiProvider = AI_PROVIDERS.includes(providerRaw as AiProvider)
    ? (providerRaw as AiProvider)
    : undefined;

  const aiBaseUrl = flags['ai-base-url'] ?? env['CCC_AI_BASE_URL'];
  const aiModel = flags['ai-model'] ?? env['CCC_AI_MODEL'];

  const budgetRaw = Number(flags['ai-budget'] ?? env['CCC_AI_BUDGET'] ?? '0.05');
  const aiBudgetUsd = Number.isFinite(budgetRaw) && budgetRaw >= 0 ? budgetRaw : 0.05;

  const transcriptRaw = flags['ai-transcript'] ?? env['CCC_AI_TRANSCRIPT'];
  const aiTranscript = transcriptRaw === 'true' || transcriptRaw === '1';

  const ttlRaw = Number(flags['run-ttl-hours'] ?? env['CCC_RUN_TTL_HOURS'] ?? '24');
  const runTtlHours = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 24;

  const difficultyRaw = flags['difficulty'] ?? env['CCC_DIFFICULTY'];
  const difficulty = DIFFICULTIES.includes(difficultyRaw as Difficulty)
    ? (difficultyRaw as Difficulty)
    : undefined;

  const modeRaw = flags['mode'] ?? env['CCC_MODE'];
  const runMode = RUN_MODES.includes(modeRaw as RunMode) ? (modeRaw as RunMode) : undefined;

  // Character id is validated against the content registry by the UI layer.
  const character = flags['character'] ?? env['CCC_CHARACTER'];

  return Object.freeze({
    saveDir,
    seed,
    snarkLevel,
    apiKey,
    aiProvider,
    aiBaseUrl,
    aiModel,
    aiBudgetUsd,
    aiTranscript,
    runTtlHours,
    difficulty,
    runMode,
    character,
  });
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[arg.slice(2)] = next;
        i++;
      } else {
        flags[arg.slice(2)] = 'true';
      }
    }
  }
  return flags;
}
