import { useCallback, useRef, useState } from 'react';
import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import { runScore } from '../progression/daily.js';
import { applyModifier, type Modifier } from '../engine/modifiers.js';
import { DEFAULT_RUN_CONFIG, content as defaultContent } from '../engine/content/index.js';
import { EngineError, isSafeBoundary } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import type { Tailer, TailerOptions } from '../events/tailer.js';
import type { SaveStore } from '../persistence/saves.js';
import type { Difficulty, RunMode, SnarkLevel } from '../config.js';
import type { DungeonAi } from '../ai/dungeonAi.js';

export interface GameDeps {
  readonly store: SaveStore;
  readonly content?: ContentRegistry;
  readonly runConfig?: RunConfig;
  /** Fixed seed (from config); new runs generate one when absent. */
  readonly seed?: string;
  readonly now?: () => number;
  /** Hook-event wiring (undefined → standalone mode). */
  readonly eventsDir?: string;
  readonly createSource?: (opts: TailerOptions) => Tailer;
  /** Explicit flag/env snark; undefined → in-game setting, then wry. */
  readonly snarkLevel?: SnarkLevel;
  readonly ai?: DungeonAi | null;
  /** Saves older than this retire as 'abandoned' (REQ-12). Default 24h. */
  readonly runTtlMs?: number;
  /** Explicit flag/env difficulty; undefined → in-game setting, then Normal. */
  readonly difficulty?: Difficulty;
  /** Explicit flag/env run mode; undefined → in-game setting, then single. */
  readonly runMode?: RunMode;
  /** Explicit flag/env character id; undefined → in-game setting, then default. */
  readonly character?: string;
  /** Dev/snapshot-only: seed a fresh run's satchel. Not wired to game defaults. */
  readonly startingPotions?: readonly string[];
}

const DEFAULT_RUN_TTL_MS = 24 * 60 * 60 * 1000;

/** Per-run launch overrides. The daily challenge passes a fixed seed + config
 * and tags the run with its date so run-end records the daily score (E3). */
export interface NewRunOptions {
  readonly seed?: string;
  readonly runConfig?: RunConfig;
  /** Daily-challenge date (`YYYY-MM-DD`); set => this run is the daily. */
  readonly daily?: string;
}

export interface Game {
  readonly state: RunState | null;
  readonly content: ContentRegistry;
  readonly hasSave: boolean;
  dispatch(action: GameAction): void;
  newRun(opts?: NewRunOptions): void;
  continueRun(): void;
  quitToTitle(): void;
  applyModifiers(mods: readonly Modifier[]): void;
}

export function useGame(deps: GameDeps): Game {
  const content = deps.content ?? defaultContent;
  const runConfig = deps.runConfig ?? DEFAULT_RUN_CONFIG;
  const now = deps.now ?? Date.now;
  const [state, setState] = useState<RunState | null>(null);
  // E3: the date this run is the daily for, set at launch. UI-state tagging
  // (a ref, not RunState) avoids a SAVE_VERSION bump; a resumed mid-daily save
  // is therefore recorded as a normal run — an accepted edge.
  const dailyRef = useRef<string | null>(null);
  const [hasSave, setHasSave] = useState(() => {
    const saved = deps.store.loadRun();
    if (!saved) return false;
    const ttl = deps.runTtlMs ?? DEFAULT_RUN_TTL_MS;
    if (now() - saved.savedAt > ttl) {
      deps.store.recordRun({
        seed: saved.state.seed,
        outcome: 'abandoned',
        endedAt: new Date(now()).toISOString(),
      });
      deps.store.clearRun();
      return false;
    }
    return true;
  });

  const dispatch = useCallback(
    (action: GameAction) => {
      if (!state) return;
      let next: RunState;
      try {
        next = applyAction(content, state, action);
      } catch (err) {
        // Invalid input for the current state is a no-op, not a crash.
        if (err instanceof EngineError) return;
        throw err;
      }
      if (next.phase === 'victory' || next.phase === 'defeat') {
        // E2: capture difficulty/mode/character so milestone rules (which derive
        // unlocks from run history) can match hard/arc victories. Omitted when
        // unknown so old/standalone records stay graceful (treated as not-matching).
        const daily = dailyRef.current;
        deps.store.recordRun({
          seed: next.seed,
          outcome: next.phase,
          endedAt: new Date(now()).toISOString(),
          ...(deps.difficulty ? { difficulty: deps.difficulty } : {}),
          ...(deps.runMode ? { mode: deps.runMode } : {}),
          ...(deps.character ? { character: deps.character } : {}),
          // #28: record the pure run score for EVERY finished run (not just the
          // daily) so personal-best tracking has data. The daily date is still
          // tagged when this run is the daily so the Title's daily-best holds.
          score: runScore(next),
          ...(daily ? { daily } : {}),
        });
        deps.store.clearRun();
        dailyRef.current = null;
        setHasSave(false);
      } else if (isSafeBoundary(next)) {
        deps.store.saveRun(next);
        setHasSave(true);
      }
      setState(next);
    },
    [state, content, deps.store, now],
  );

  const newRun = useCallback(
    (opts?: NewRunOptions) => {
      const seed =
        opts?.seed ??
        deps.seed ??
        `run-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const fresh = createRun(content, seed, opts?.runConfig ?? runConfig);
      dailyRef.current = opts?.daily ?? null;
      deps.store.saveRun(fresh);
      setHasSave(true);
      setState(fresh);
    },
    [content, runConfig, deps.seed, deps.store, now],
  );

  const continueRun = useCallback(() => {
    // A resumed save is not tracked as the daily (UI-state tag does not persist).
    dailyRef.current = null;
    const saved = deps.store.loadRun();
    if (saved) setState(saved.state);
  }, [deps.store]);

  const quitToTitle = useCallback(() => {
    dailyRef.current = null;
    setState(null);
  }, []);

  const applyModifiers = useCallback(
    (mods: readonly Modifier[]) => {
      if (!state || mods.length === 0) return;
      let next = state;
      for (const mod of mods) next = applyModifier(content, next, mod);
      if (next === state) return;
      if (isSafeBoundary(next)) deps.store.saveRun(next);
      setState(next);
    },
    [state, content, deps.store],
  );

  return {
    state,
    content,
    hasSave,
    dispatch,
    newRun,
    continueRun,
    quitToTitle,
    applyModifiers,
  };
}
