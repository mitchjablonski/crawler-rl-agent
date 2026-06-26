/**
 * Headless play harness: drives the real App through ink-testing-library using
 * the same in-memory seams the unit tests + make-gif use, plus an autoplayer
 * that walks a whole run by reading the rendered frames and deciding inputs.
 *
 * This is how an agent "plays the game" for verification: no real saves, no real
 * hook files, no AI calls — just the actual UI + engine, driven and observed.
 * Dev-only tooling, not shipped in the package.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/App.js';
import type {
  MetaSettings,
  MetaState,
  RunRecord,
  SaveStore,
} from '../../src/persistence/saves.js';
import type { RunState } from '../../src/engine/types.js';
import type { HookRecord } from '../../src/events/types.js';
import type { TailerOptions, Tailer } from '../../src/events/tailer.js';
import type { DungeonAi } from '../../src/ai/dungeonAi.js';
import type { GameDeps } from '../../src/ui/useGame.js';

// --- in-memory store (no disk) ---
export function memoryStore(): SaveStore {
  let run: RunState | null = null;
  const runs: RunRecord[] = [];
  let settings: MetaSettings = {};
  return {
    loadRun: () => (run ? { state: run, savedAt: 0 } : null),
    saveRun: (s) => {
      run = s;
    },
    clearRun: () => {
      run = null;
    },
    loadMeta: (): MetaState => ({ version: 1, runs, settings }),
    recordRun: (r) => {
      runs.push(r);
    },
    updateSettings: (s) => {
      settings = { ...settings, ...s };
    },
  };
}

// --- fake hook event source you can push records into ---
export function makeSource(): {
  createSource: (opts: TailerOptions) => Tailer;
  emit: (r: HookRecord) => void;
} {
  let sink: (r: HookRecord) => void = () => {};
  return {
    createSource: (opts: TailerOptions) => {
      sink = (r) => opts.onRecord(r);
      return { start: () => {}, stop: () => {}, poll: () => {} };
    },
    emit: (r) => sink(r),
  };
}

export const staticAi: DungeonAi = {
  backend: 'static',
  narrate: () => {},
  christen: () => {},
  spentUsd: () => 0,
};

export function hook(hookType: string, payload: Record<string, unknown> = {}): HookRecord {
  return { hookType, receivedAt: 't', payload };
}

export const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ANSI = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export interface Harness {
  /** raw frame, ANSI intact (feed to termRender) */
  raw(): string;
  /** frame with ANSI stripped (for text assertions) */
  text(): string;
  /** send one key and wait a tick for React to settle */
  press(input: string): Promise<void>;
  /** push a hook event (tests passing, Claude stopping, etc.) */
  emit(r: HookRecord): void;
  store: SaveStore;
  unmount(): void;
}

export async function startApp(overrides: Partial<GameDeps> = {}): Promise<Harness> {
  const store = overrides.store ?? memoryStore();
  const src = makeSource();
  const deps: GameDeps = {
    store,
    seed: 'verify',
    createSource: src.createSource,
    ai: staticAi,
    now: () => 0,
    ...overrides,
  };
  const inst = render(React.createElement(App, { deps }));
  await tick();
  return {
    raw: () => inst.lastFrame() ?? '',
    text: () => stripAnsi(inst.lastFrame() ?? ''),
    press: async (input: string) => {
      inst.stdin.write(input);
      await tick();
    },
    emit: src.emit,
    store,
    unmount: () => inst.unmount(),
  };
}

export type Phase =
  | 'title'
  | 'map'
  | 'combat'
  | 'reward'
  | 'shop'
  | 'rest'
  | 'event'
  | 'pause'
  | 'victory'
  | 'defeat'
  | 'unknown';

export function detectPhase(text: string): Phase {
  if (/CLAUDE AWAITS|ATTENTION REQUIRED|PAIR PARTNER AWAITS/.test(text)) return 'pause';
  if (text.includes('CLAUDE CODE CRAWLER')) return 'title';
  if (text.includes('THE SCOPE CREEP IS SLAIN')) return 'victory';
  if (text.includes('YOU DIED')) return 'defeat';
  if (text.includes('Your hand:') || text.includes('Choose a target:')) return 'combat';
  if (text.includes('Choose your path')) return 'map';
  if (text.includes('Victory!')) return 'reward';
  if (text.includes('cloaked merchant')) return 'shop';
  if (text.includes('defensible alcove')) return 'rest';
  // Event screens have no single stable anchor; treat an otherwise-unknown
  // in-run screen with numbered options as an event.
  if (/\[1\]/.test(text)) return 'event';
  return 'unknown';
}

export interface StepLog {
  step: number;
  phase: Phase;
  input: string;
}

export interface AutoPlayResult {
  steps: StepLog[];
  phasesSeen: Phase[];
  finalPhase: Phase;
  reachedGameOver: boolean;
  /** True iff the autoplayer used at least one potion through the UI. */
  usedPotion: boolean;
  /** True iff the autoplayer upgraded a card via the rest-site upgrade path. */
  upgradedCard: boolean;
  /** True iff the autoplayer resolved an event through its result screen. */
  eventResolved: boolean;
  /** True iff the autoplayer opened (and closed) the deck-view overlay. */
  viewedDeck: boolean;
}

/** First potion hotkey letter shown on a Satchel: line, or null if none. */
function firstSatchelKey(text: string): string | null {
  const line = text.split('\n').find((l) => l.includes('Satchel:'));
  if (!line) return null;
  const m = /\(([a-z])\)/.exec(line);
  return m ? m[1]! : null;
}

/** First affordable+buyable shop potion letter, or null. */
function buyablePotionKey(text: string): string | null {
  let inPotions = false;
  for (const line of text.split('\n')) {
    if (line.includes('Potions:')) {
      inPotions = true;
      continue;
    }
    if (!inPotions) continue;
    // A buyable potion line shows "(x) Name - desc  NNg"; sold/unaffordable
    // lines either say "(sold)" or are dim — but dim is lost after stripAnsi,
    // so we gate buying on the shop letter existing and a price being shown.
    const m = /\(([a-z])\)\s.+\s(\d+)g\b/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Walk a whole run by reading frames and choosing inputs. Calls onSnapshot the
 * first time each phase is seen. Returns a log + the set of phases visited.
 * Deterministic given the seed (input policy is fixed).
 */
export async function autoPlay(
  h: Harness,
  opts: {
    maxSteps?: number;
    onSnapshot?: (phase: Phase, raw: string) => Promise<void> | void;
  } = {},
): Promise<AutoPlayResult> {
  const maxSteps = opts.maxSteps ?? 600;
  const steps: StepLog[] = [];
  const seen = new Set<Phase>();
  let combatCard = 1;
  let usedPotion = false;
  // Use a held potion at most twice across the run so the satchel→usePotion
  // keypath is exercised end-to-end without stalling progress.
  let potionUseBudget = 2;
  let boughtPotion = false;
  // Exercise the rest-site upgrade keypath ([u] then [1]) on the first rest that
  // offers an upgradeable card; thereafter rests just heal ([r]).
  let upgradedCard = false;
  let triedUpgrade = false;
  let eventResolved = false;
  // Open the deck-view overlay once (first map) so the overlay path gets smoke
  // coverage: press 'v' to open, snapshot it, press 'v' to close.
  let viewedDeck = false;
  // The option to try next on an event screen; advances if a press changes nothing
  // (gated/unavailable option), resets once an option is taken.
  let eventOption = 1;

  const snapshotIfNew = async (phase: Phase) => {
    if (phase !== 'unknown' && !seen.has(phase)) {
      seen.add(phase);
      if (opts.onSnapshot) await opts.onSnapshot(phase, h.raw());
    }
  };

  for (let step = 0; step < maxSteps; step++) {
    const before = h.text();
    const phase = detectPhase(before);
    await snapshotIfNew(phase);

    if (phase === 'victory' || phase === 'defeat') {
      return {
        steps,
        phasesSeen: [...seen],
        finalPhase: phase,
        reachedGameOver: true,
        usedPotion,
        upgradedCard,
        eventResolved,
        viewedDeck,
      };
    }

    // --- Potion keypath coverage (highest priority) ---
    // In combat: if the satchel holds a potion and budget remains, use the
    // first slot; a self potion resolves immediately, an enemy potion enters
    // target-select which the normal combat branch then answers with '1'.
    if (phase === 'combat' && potionUseBudget > 0 && !before.includes('Choose a target:')) {
      const key = firstSatchelKey(before);
      if (key) {
        await h.press(key);
        steps.push({ step, phase, input: key });
        const afterKey = h.text();
        if (afterKey.includes('Choose a target:')) {
          await h.press('1');
          steps.push({ step, phase, input: '1' });
        }
        potionUseBudget--;
        usedPotion = true;
        combatCard = 1;
        continue;
      }
    }
    // In the shop: buy one affordable potion (slot permitting) before leaving so
    // a satchel gets populated for the combat keypath above.
    if (phase === 'shop' && !boughtPotion) {
      const key = buyablePotionKey(before);
      if (key) {
        await h.press(key);
        steps.push({ step, phase, input: key });
        boughtPotion = true;
        continue;
      }
    }

    // --- Rest-site upgrade keypath coverage ---
    // On the first rest, try the upgrade view: press [u]; if it opens an upgrade
    // list (a numbered card tile appears) press [1] to upgrade. Falls through to
    // [r] (heal) on later rests or if nothing is upgradeable.
    if (phase === 'rest' && !triedUpgrade) {
      triedUpgrade = true;
      await h.press('u');
      steps.push({ step, phase, input: 'u' });
      const afterU = h.text();
      if (afterU.includes('Upgrade a card:') && /\[1\]/.test(afterU)) {
        await h.press('1');
        steps.push({ step, phase, input: '1' });
        // Upgrading returns to the map; if it did, count it.
        if (detectPhase(h.text()) !== 'rest') upgradedCard = true;
        continue;
      }
      // Upgrade view didn't open (no upgradeable cards) — heal instead.
      await h.press('r');
      steps.push({ step, phase, input: 'r' });
      continue;
    }

    // --- Deck-view overlay smoke coverage ---
    // On the first map, open the read-only deck overlay, snapshot it, then close
    // it. The overlay is App-local UI (no engine phase), so detectPhase still
    // reads 'map' underneath; we drive it directly here.
    if (phase === 'map' && !viewedDeck) {
      viewedDeck = true;
      await h.press('v');
      steps.push({ step, phase, input: 'v' });
      const open = h.text();
      if (open.includes('Your deck')) {
        if (opts.onSnapshot && !seen.has('deck' as Phase)) {
          seen.add('deck' as Phase);
          await opts.onSnapshot('deck' as Phase, h.raw());
        }
      }
      await h.press('v'); // close back to the map
      steps.push({ step, phase, input: 'v' });
      continue;
    }

    let input: string;
    switch (phase) {
      case 'title':
        input = 'n';
        break;
      case 'map':
        input = pickMapOption(before);
        break;
      case 'combat':
        if (before.includes('Choose a target:')) input = '1';
        else input = String(combatCard);
        break;
      case 'reward':
        input = '1';
        break;
      case 'shop':
        input = 'l';
        break;
      case 'rest':
        input = 'r';
        break;
      case 'event':
        // Result screen ([1] Continue) → press 1 to return to the map. Option
        // screen → try the current candidate option (advanced below if gated).
        input = before.includes('Continue') ? '1' : String(eventOption);
        break;
      case 'pause':
        input = 'p';
        break;
      default:
        input = '1';
    }

    await h.press(input);
    steps.push({ step, phase, input });
    const after = h.text();

    // Combat hand-scan: if a non-target keypress changed nothing, the card was
    // unaffordable/invalid — advance to the next card; once the hand is
    // exhausted, end the turn.
    if (phase === 'combat' && !before.includes('Choose a target:')) {
      if (after === before) {
        combatCard++;
        if (combatCard > 6) {
          await h.press('e');
          steps.push({ step, phase, input: 'e' });
          combatCard = 1;
        }
      } else {
        combatCard = 1;
      }
    }

    // Reward fallback: if "take first" did nothing, skip.
    if (phase === 'reward' && after === before) await h.press('s');

    // Event handling: track the result-screen→continue keypath and step past
    // gated options (a press that changed nothing means that option is locked).
    if (phase === 'event') {
      const wasResult = before.includes('Continue');
      if (wasResult) {
        // We continued past a result screen → an event was fully resolved.
        if (after !== before) eventResolved = true;
        eventOption = 1;
      } else if (after === before) {
        // Gated/unavailable option → advance to the next candidate.
        eventOption++;
        if (eventOption > 6) eventOption = 1;
      } else {
        // An option was taken; the next frame is either a result screen or the
        // map. Reset the option cursor for the next event.
        eventOption = 1;
      }
    }
  }

  const finalPhase = detectPhase(h.text());
  return {
    steps,
    phasesSeen: [...seen],
    finalPhase,
    reachedGameOver: false,
    usedPotion,
    upgradedCard,
    eventResolved,
  };
}

/** Prefer a Combat/elite node so a smoke run actually fights; else first path. */
function pickMapOption(text: string): string {
  for (const line of text.split('\n')) {
    const m = /\[(\d+)\]\s+(Combat|ELITE combat|THE BOSS)/.exec(line);
    if (m) return m[1]!;
  }
  return '1';
}
