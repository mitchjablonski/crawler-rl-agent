import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'ink';
import { useGame, type GameDeps } from './useGame.js';
import { useEvents } from './useEvents.js';
import { useChristenings } from './useChristenings.js';
import { isSafeBoundary } from '../engine/types.js';
import type { SnarkLevel, Difficulty, RunMode } from '../config.js';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  knobsFor,
  DEFAULT_RUN_MODE,
  RUN_MODES,
  actsForMode,
} from '../config.js';
import type { RunConfig } from '../engine/run.js';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER } from '../engine/content/index.js';
import { deriveUnlocks, ALL_UNLOCKABLE_IDS } from '../progression/milestones.js';
import {
  dailySeed,
  dailyDate,
  bestDailyScore,
  runScore,
  bestRun,
  DAILY_DIFFICULTY,
  DAILY_MODE,
  DAILY_CHARACTER,
} from '../progression/daily.js';
import type { RunSummary } from '../ai/dungeonAi.js';
import { StatusBar } from './components/StatusBar.js';
import { PauseOverlay } from './components/PauseOverlay.js';
import { DeckView } from './components/DeckView.js';
import { Title } from './screens/Title.js';
import { MapScreen } from './screens/MapScreen.js';
import { CombatScreen } from './screens/CombatScreen.js';
import { RewardScreen } from './screens/RewardScreen.js';
import { ShopScreen } from './screens/ShopScreen.js';
import { RestScreen } from './screens/RestScreen.js';
import { EventScreen } from './screens/EventScreen.js';
import { GameOverScreen } from './screens/GameOverScreen.js';

export function App({ deps }: { readonly deps: GameDeps }) {
  const [difficulty, setDifficulty] = useState<Difficulty>(
    () => deps.difficulty ?? deps.store.loadMeta().settings?.difficulty ?? DEFAULT_DIFFICULTY,
  );
  const [runMode, setRunMode] = useState<RunMode>(
    () => deps.runMode ?? deps.store.loadMeta().settings?.runMode ?? DEFAULT_RUN_MODE,
  );
  const validClass = (id: string | undefined): string | undefined =>
    id !== undefined && CHARACTERS[id] !== undefined ? id : undefined;
  const [character, setCharacter] = useState<string>(
    () =>
      validClass(deps.character) ??
      validClass(deps.store.loadMeta().settings?.character) ??
      DEFAULT_CHARACTER,
  );
  // E2: unlocks are DERIVED from run history. `unlocked` is the set of EXTRA
  // content ids earned so far; it is re-read from meta whenever a run finishes
  // (see refreshUnlocks below) so a milestone crossed mid-session takes effect on
  // the next run and surfaces on the Title. The allow set fed to the engine is
  // exactly these ids → still-locked unlockables stay out of the draft pool.
  const [unlocked, setUnlocked] = useState<readonly string[]>(
    () => [...deriveUnlocks(deps.store.loadMeta())],
  );
  const refreshUnlocks = useCallback(() => {
    setUnlocked((prev) => {
      const next = [...deriveUnlocks(deps.store.loadMeta())];
      // Stable identity when nothing changed, so the Title diff stays accurate.
      return next.length === prev.length && next.every((id) => prev.includes(id)) ? prev : next;
    });
  }, [deps.store]);
  // Ids that crossed a milestone in the just-finished run (before/after diff),
  // surfaced as a "NEW unlocked" highlight on the Title until the next new run.
  const [justUnlocked, setJustUnlocked] = useState<readonly string[]>([]);
  const runConfig = useMemo<RunConfig>(() => {
    const k = knobsFor(difficulty, runMode);
    const cls = CHARACTERS[character] ?? CHARACTERS[DEFAULT_CHARACTER]!;
    return {
      starterDeck: cls.starterDeck,
      startingRelics: cls.startingRelics,
      maxHp: cls.maxHp,
      startingGold: k.startingGold,
      enemyHpMult: k.enemyHpMult,
      ...(k.actHpRamp ? { actHpRamp: k.actHpRamp } : {}),
      eventLoseHpMult: k.eventLoseHpMult,
      acts: actsForMode(runMode),
      // E2: only EARNED unlockables enter the pool. Empty for a fresh player →
      // core-only pool, byte-identical to pre-E2 (and the harness uses DEFAULT).
      ...(unlocked.length > 0 ? { allowedUnlockIds: unlocked } : {}),
      // Dev/snapshot-only seam; production never sets this (stays undefined → []).
      ...(deps.startingPotions ? { startingPotions: deps.startingPotions } : {}),
    };
  }, [difficulty, runMode, character, unlocked, deps.startingPotions]);
  const cycleCharacter = useCallback(() => {
    setCharacter((prev) => {
      const next = CHARACTER_IDS[
        (CHARACTER_IDS.indexOf(prev) + 1) % CHARACTER_IDS.length
      ] as string;
      deps.store.updateSettings({ character: next });
      return next;
    });
  }, [deps.store]);
  const cycleDifficulty = useCallback(() => {
    setDifficulty((prev) => {
      const next = DIFFICULTIES[
        (DIFFICULTIES.indexOf(prev) + 1) % DIFFICULTIES.length
      ] as Difficulty;
      deps.store.updateSettings({ difficulty: next });
      return next;
    });
  }, [deps.store]);
  const cycleRunMode = useCallback(() => {
    setRunMode((prev) => {
      const next = RUN_MODES[(RUN_MODES.indexOf(prev) + 1) % RUN_MODES.length] as RunMode;
      deps.store.updateSettings({ runMode: next });
      return next;
    });
  }, [deps.store]);

  // E2: pass the RESOLVED difficulty/mode/character so run-end records carry them
  // for milestone matching (deps.* are only the explicit flag/env overrides).
  const game = useGame({ ...deps, runConfig, difficulty, runMode, character });
  // UI-only overlay: inspect the full deck from the map. App-local state, like
  // the pause overlay — the engine has no deck-view phase and no GameAction.
  const [deckOpen, setDeckOpen] = useState(false);
  const [snark, setSnark] = useState<SnarkLevel>(
    () => deps.snarkLevel ?? deps.store.loadMeta().settings?.snarkLevel ?? 1,
  );
  const cycleSnark = useCallback(() => {
    setSnark((prev) => {
      const next = ((prev + 1) % 3) as SnarkLevel;
      deps.store.updateSettings({ snarkLevel: next });
      return next;
    });
  }, [deps.store]);

  // Ref-based getter so useEvents' tailer never re-subscribes on state churn.
  const stateRef = useRef(game.state);
  stateRef.current = game.state;
  const getRunSummary = useCallback((): RunSummary | null => {
    const run = stateRef.current;
    if (!run) return null;
    return {
      hp: run.hp,
      maxHp: run.maxHp,
      gold: run.gold,
      depth: run.map.nodes[run.currentNodeId]?.row ?? 0,
    };
  }, []);

  const events = useEvents({
    eventsDir: deps.eventsDir,
    createSource: deps.createSource,
    now: deps.now,
    snark,
    ai: deps.ai,
    getRunSummary,
  });

  const christenings = useChristenings({ ai: deps.ai, snark, getRunSummary });

  // Bounded modifiers apply only at engine-defined safe boundaries; elite
  // spawns get christened after the work that summoned them.
  const { state, applyModifiers, content: gameContent } = game;
  const { eventTick, takeQueued } = events;
  const { request: requestChristening } = christenings;
  useEffect(() => {
    if (!state || !isSafeBoundary(state)) return;
    const queued = takeQueued();
    if (queued.length === 0) return;
    applyModifiers(queued.map((q) => q.modifier));
    for (const q of queued) {
      if (q.modifier.kind === 'queueElite') {
        const base = gameContent.enemies[q.modifier.enemyId]?.name ?? q.modifier.enemyId;
        requestChristening('enemy', q.modifier.enemyId, base, q.event);
      }
    }
  }, [eventTick, state, applyModifiers, takeQueued, requestChristening, gameContent]);

  // The boss earns a session-themed epithet the moment its fight begins.
  useEffect(() => {
    if (!state || state.phase !== 'combat' || !state.combat) return;
    for (const enemy of state.combat.enemies) {
      if (gameContent.enemies[enemy.defId]?.isBoss) {
        requestChristening('boss', enemy.defId, enemy.name);
      }
    }
  }, [state, requestChristening, gameContent]);

  // Relic drops get repo-aware epithets while the reward screen is up.
  useEffect(() => {
    const relicId = state?.reward?.relicId;
    if (!relicId) return;
    requestChristening('relic', relicId, gameContent.relics[relicId]?.name ?? relicId);
  }, [state, requestChristening, gameContent]);

  // E2: when a run resolves, the record is already written; re-derive unlocks and
  // capture the before/after diff so the Title can flash "NEW unlocked". Runs once
  // per terminal phase (guarded by a ref) so re-renders don't re-fire the diff.
  const recordedOutcomeRef = useRef<string | null>(null);
  const overPhase =
    game.state && (game.state.phase === 'victory' || game.state.phase === 'defeat')
      ? game.state.phase
      : null;
  useEffect(() => {
    if (!overPhase) {
      recordedOutcomeRef.current = null;
      return;
    }
    if (recordedOutcomeRef.current === overPhase) return;
    recordedOutcomeRef.current = overPhase;
    const before = unlocked;
    const after = [...deriveUnlocks(deps.store.loadMeta())];
    const fresh = after.filter((id) => !before.includes(id));
    if (fresh.length > 0) setJustUnlocked(fresh);
    refreshUnlocks();
  }, [overPhase, unlocked, deps.store, refreshUnlocks]);

  // E3: the date of the daily currently in progress (null for a normal run), so
  // GameOver can show the daily score. Mirrors useGame's daily tag at the UI
  // layer; cleared whenever a non-daily run starts or we return to the title.
  const [dailyRunDate, setDailyRunDate] = useState<string | null>(null);
  const newRun = () => {
    christenings.reset();
    setJustUnlocked([]);
    refreshUnlocks();
    setDailyRunDate(null);
    game.newRun();
  };
  const newDailyRun = () => {
    christenings.reset();
    setJustUnlocked([]);
    refreshUnlocks();
    const ms = (deps.now ?? Date.now)();
    const date = dailyDate(ms);
    setDailyRunDate(date);
    // Canonical daily config: fixed difficulty/mode/character for fairness, so
    // everyone with the same date plays the byte-identical seeded run.
    const k = knobsFor(DAILY_DIFFICULTY, DAILY_MODE);
    const cls = CHARACTERS[DAILY_CHARACTER] ?? CHARACTERS[DEFAULT_CHARACTER]!;
    const dailyConfig: RunConfig = {
      starterDeck: cls.starterDeck,
      startingRelics: cls.startingRelics,
      maxHp: cls.maxHp,
      startingGold: k.startingGold,
      enemyHpMult: k.enemyHpMult,
      ...(k.actHpRamp ? { actHpRamp: k.actHpRamp } : {}),
      eventLoseHpMult: k.eventLoseHpMult,
      acts: actsForMode(DAILY_MODE),
      // The daily is a FIXED shared run: no per-player unlock pool, so the seed
      // fully determines it for everyone (unlockables would fork the run).
    };
    game.newRun({ seed: dailySeed(ms), runConfig: dailyConfig, daily: date });
  };
  const quitToTitle = () => {
    setDailyRunDate(null);
    game.quitToTitle();
  };
  const enemyDisplayName = (defId: string) =>
    christenings.nameFor('boss', defId) ?? christenings.nameFor('enemy', defId);

  if (!game.state) {
    const nameOf = (id: string): string =>
      game.content.cards[id]?.name ?? game.content.relics[id]?.name ?? id;
    const todaysDaily = dailyDate((deps.now ?? Date.now)());
    const dailyBest = bestDailyScore(deps.store.loadMeta(), todaysDaily);
    return (
      <Title
        hasSave={game.hasSave}
        dailyDate={todaysDaily}
        dailyBest={dailyBest}
        onDaily={newDailyRun}
        snark={snark}
        difficulty={difficulty}
        runMode={runMode}
        characterName={CHARACTERS[character]?.name ?? character}
        characterDescription={CHARACTERS[character]?.description ?? ''}
        aiBackend={deps.ai?.backend ?? 'static'}
        unlockedCount={unlocked.length}
        unlockableTotal={ALL_UNLOCKABLE_IDS.size}
        unlockedNames={unlocked.map(nameOf).sort()}
        justUnlockedNames={justUnlocked.map(nameOf).sort()}
        onNew={newRun}
        onContinue={game.continueRun}
        onCycleSnark={cycleSnark}
        onCycleDifficulty={cycleDifficulty}
        onCycleRunMode={cycleRunMode}
        onCycleCharacter={cycleCharacter}
      />
    );
  }

  const run = game.state;
  const over = run.phase === 'victory' || run.phase === 'defeat';
  // Persistent relic display: relics are the primary power-build mechanic but
  // were only shown once on the reward screen. Surface held relics in the HUD,
  // preferring the christened epithet over the base relic name.
  const relicNames = run.relics.map(
    (id) => christenings.nameFor('relic', id) ?? game.content.relics[id]?.name ?? id,
  );

  // #52: the active class display name, surfaced in the HUD + GameOver report so
  // the player's class identity is visible throughout the run (not just Title).
  const activeCharacterName = CHARACTERS[character]?.name ?? character;

  // #28: personal best for this run's (character, mode) among PRIOR runs. The
  // finished run is already appended to history (recordRun pushes to the end at
  // run-end), so we drop the last record to compare "NEW BEST" against the prior
  // best — a record/first run reads as a new best. Computed at render so GameOver
  // shows it on first paint (a post-render effect/ref would lag a frame). null
  // until the run is over.
  const priorBest = over
    ? (() => {
        const meta = deps.store.loadMeta();
        return bestRun({ ...meta, runs: meta.runs.slice(0, -1) }, { character, mode: runMode });
      })()
    : null;

  // #46: names of the unlocks this run just earned (same `justUnlocked` diff the
  // Title flashes), resolved id->name exactly as the Title path does, so GameOver
  // can celebrate them at the run's peak moment. Empty unless a milestone crossed.
  const unlockedNames = justUnlocked
    .map((id) => game.content.cards[id]?.name ?? game.content.relics[id]?.name ?? id)
    .sort();

  return (
    <Box flexDirection="column">
      {!over && (
        <StatusBar
          state={run}
          linked={events.linked}
          narration={events.narration}
          relics={relicNames}
          characterName={activeCharacterName}
        />
      )}
      {events.pause && !over ? (
        <PauseOverlay pause={events.pause} snark={snark} onDismiss={events.dismissPause} />
      ) : deckOpen && (run.phase === 'map' || run.phase === 'combat') && !over ? (
        // Deck-view overlay captures input; the underlying screen's keys don't
        // fire. #56: also opens over combat (read-only, grouped by pile) so the
        // player can check "what's still in my draw pile?" mid-fight.
        <DeckView state={run} content={game.content} onClose={() => setDeckOpen(false)} />
      ) : (
        <>
          {run.phase === 'map' && (
            <MapScreen
              state={run}
              content={game.content}
              dispatch={game.dispatch}
              onViewDeck={() => setDeckOpen(true)}
            />
          )}
          {run.phase === 'combat' && (
            <CombatScreen
              state={run}
              content={game.content}
              dispatch={game.dispatch}
              nameFor={enemyDisplayName}
              onViewDeck={() => setDeckOpen(true)}
            />
          )}
          {run.phase === 'reward' && (
            <RewardScreen
              state={run}
              content={game.content}
              dispatch={game.dispatch}
              relicDisplayName={
                run.reward?.relicId
                  ? christenings.nameFor('relic', run.reward.relicId)
                  : undefined
              }
            />
          )}
          {run.phase === 'shop' && (
            <ShopScreen state={run} content={game.content} dispatch={game.dispatch} />
          )}
          {run.phase === 'rest' && (
            <RestScreen state={run} content={game.content} dispatch={game.dispatch} />
          )}
          {run.phase === 'event' && (
            <EventScreen state={run} content={game.content} dispatch={game.dispatch} />
          )}
          {over && (
            <GameOverScreen
              state={run}
              relicNames={relicNames}
              characterName={activeCharacterName}
              onNew={newRun}
              onTitle={quitToTitle}
              score={runScore(run)}
              priorBest={priorBest}
              unlockedNames={unlockedNames}
              {...(dailyRunDate ? { dailyDate: dailyRunDate } : {})}
            />
          )}
        </>
      )}
    </Box>
  );
}
