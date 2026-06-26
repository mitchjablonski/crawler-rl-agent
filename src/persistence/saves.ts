import fs from 'node:fs';
import path from 'node:path';
import type { RunState } from '../engine/types.js';

// In-progress RUN saves. Bumped to 9 in #25: RunState gained `stats` (per-run
// cumulative counters) and CombatState gained scoped `dealt`/`taken`/`slain`. A
// v8 in-progress save lacks these, so it quarantines on load — acceptable for a
// transient run (per-run determinism is preserved by storing counters on state).
// META (run history) is versioned and migrated SEPARATELY below so progression
// data is NEVER wiped by this bump.
const SAVE_VERSION = 10; // v10: RunState gained eventLoseHpMult (#34 difficulty event scaling)

/**
 * Current meta (progression) schema version. Decoupled from SAVE_VERSION so an
 * in-progress-run shape change never threatens the precious run history. Bump
 * this ONLY for a meta-shape change, and migrate in `loadMeta` — never quarantine
 * run records on a version delta.
 */
const META_VERSION = 2; // v2: RunRecord gained optional difficulty/mode/character

export interface RunRecord {
  readonly seed: string;
  readonly outcome: 'victory' | 'defeat' | 'abandoned';
  readonly endedAt: string; // ISO timestamp
  /** E2: captured at run-end for milestone rules. Absent on pre-E2 records. */
  readonly difficulty?: 'story' | 'normal' | 'hard' | 'nightmare';
  /** E2: 'single' | 'arc'. Absent on pre-E2 records (treated as not-matching). */
  readonly mode?: 'single' | 'arc';
  /** E2: character class id. Absent on pre-E2 records. */
  readonly character?: string;
  /** E3: the daily-challenge date (`YYYY-MM-DD`) this run was the daily for. */
  readonly daily?: string;
  /** E3: the daily score (pure derivation over the final state). */
  readonly score?: number;
}

export interface MetaSettings {
  readonly snarkLevel?: 0 | 1 | 2;
  readonly difficulty?: 'story' | 'normal' | 'hard' | 'nightmare';
  readonly runMode?: 'single' | 'arc';
  readonly character?: string;
}

export interface MetaState {
  readonly version: number;
  readonly runs: readonly RunRecord[];
  readonly settings?: MetaSettings;
}

export interface SavedRun {
  readonly state: RunState;
  readonly savedAt: number;
}

export interface SaveStore {
  loadRun(): SavedRun | null;
  saveRun(state: RunState): void;
  clearRun(): void;
  loadMeta(): MetaState;
  recordRun(record: RunRecord): void;
  updateSettings(settings: MetaSettings): void;
}

const EMPTY_META: MetaState = { version: META_VERSION, runs: [] };

/** A run record is valid if it at least carries the always-present core fields. */
function isRunRecord(v: unknown): v is RunRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RunRecord).seed === 'string' &&
    typeof (v as RunRecord).outcome === 'string' &&
    typeof (v as RunRecord).endedAt === 'string'
  );
}

export function createSaveStore(saveDir: string, now: () => number = Date.now): SaveStore {
  const runFile = path.join(saveDir, 'run.json');
  const metaFile = path.join(saveDir, 'meta.json');

  return {
    loadRun(): SavedRun | null {
      const data = readJson(runFile);
      if (
        data === null ||
        typeof data !== 'object' ||
        (data as { version?: unknown }).version !== SAVE_VERSION ||
        typeof (data as { state?: unknown }).state !== 'object' ||
        typeof (data as { savedAt?: unknown }).savedAt !== 'number'
      ) {
        if (data !== null) quarantine(runFile);
        return null;
      }
      const entry = data as { state: RunState; savedAt: number };
      return { state: entry.state, savedAt: entry.savedAt };
    },

    saveRun(state: RunState): void {
      writeJsonAtomic(runFile, { version: SAVE_VERSION, savedAt: now(), state });
    },

    clearRun(): void {
      fs.rmSync(runFile, { force: true });
    },

    loadMeta(): MetaState {
      const data = readJson(metaFile);
      // INVARIANT (E2 #2): run history is precious progression data and MUST
      // survive any version delta. We MIGRATE rather than quarantine: as long as
      // a usable `runs` array is present we keep every valid record (regardless
      // of the stored version), normalize the version forward, and carry settings
      // through. Only a truly unreadable/garbage file (no runs array) falls back
      // to empty — and that's just a missing/corrupt file, not a version bump.
      if (
        data === null ||
        typeof data !== 'object' ||
        !Array.isArray((data as { runs?: unknown }).runs)
      ) {
        if (data !== null) quarantine(metaFile);
        return EMPTY_META;
      }
      const raw = data as { version?: unknown; runs: unknown[]; settings?: unknown };
      const runs = raw.runs.filter(isRunRecord);
      const settingsOk =
        typeof raw.settings === 'object' && raw.settings !== null && !Array.isArray(raw.settings);
      return {
        version: META_VERSION,
        runs,
        ...(settingsOk ? { settings: raw.settings as MetaSettings } : {}),
      };
    },

    recordRun(record: RunRecord): void {
      const meta = this.loadMeta();
      writeJsonAtomic(metaFile, { ...meta, runs: [...meta.runs, record] });
    },

    updateSettings(settings: MetaSettings): void {
      const meta = this.loadMeta();
      writeJsonAtomic(metaFile, {
        ...meta,
        settings: { ...meta.settings, ...settings },
      });
    },
  };
}

/** Parse a JSON file; on any read/parse failure, quarantine it and return null. */
function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // missing file is the normal empty state
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    quarantine(file);
    return null;
  }
}

function quarantine(file: string): void {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
  } catch {
    // Quarantine is best-effort; never let it block a launch.
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
