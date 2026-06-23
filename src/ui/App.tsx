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
import type { RunSummary } from '../ai/dungeonAi.js';
import { StatusBar } from './components/StatusBar.js';
import { PauseOverlay } from './components/PauseOverlay.js';
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
  const runConfig = useMemo<RunConfig>(() => {
    const k = knobsFor(difficulty, runMode);
    const cls = CHARACTERS[character] ?? CHARACTERS[DEFAULT_CHARACTER]!;
    return {
      starterDeck: cls.starterDeck,
      startingRelics: cls.startingRelics,
      maxHp: cls.maxHp,
      startingGold: k.startingGold,
      enemyHpMult: k.enemyHpMult,
      acts: actsForMode(runMode),
    };
  }, [difficulty, runMode, character]);
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

  const game = useGame({ ...deps, runConfig });
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

  const newRun = () => {
    christenings.reset();
    game.newRun();
  };
  const enemyDisplayName = (defId: string) =>
    christenings.nameFor('boss', defId) ?? christenings.nameFor('enemy', defId);

  if (!game.state) {
    return (
      <Title
        hasSave={game.hasSave}
        snark={snark}
        difficulty={difficulty}
        runMode={runMode}
        characterName={CHARACTERS[character]?.name ?? character}
        aiBackend={deps.ai?.backend ?? 'static'}
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

  return (
    <Box flexDirection="column">
      {!over && (
        <StatusBar state={run} linked={events.linked} narration={events.narration} />
      )}
      {events.pause && !over ? (
        <PauseOverlay pause={events.pause} snark={snark} onDismiss={events.dismissPause} />
      ) : (
        <>
          {run.phase === 'map' && <MapScreen state={run} dispatch={game.dispatch} />}
          {run.phase === 'combat' && (
            <CombatScreen
              state={run}
              content={game.content}
              dispatch={game.dispatch}
              nameFor={enemyDisplayName}
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
          {run.phase === 'rest' && <RestScreen dispatch={game.dispatch} />}
          {run.phase === 'event' && (
            <EventScreen state={run} content={game.content} dispatch={game.dispatch} />
          )}
          {over && (
            <GameOverScreen state={run} onNew={newRun} onTitle={game.quitToTitle} />
          )}
        </>
      )}
    </Box>
  );
}
