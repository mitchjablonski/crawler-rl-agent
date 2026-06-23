import fs from 'node:fs';
import path from 'node:path';
import type { RunState } from '../engine/types.js';

const SAVE_VERSION = 4; // v4: RunState gained enemyHpMult (difficulty)

export interface RunRecord {
  readonly seed: string;
  readonly outcome: 'victory' | 'defeat' | 'abandoned';
  readonly endedAt: string; // ISO timestamp
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

const EMPTY_META: MetaState = { version: SAVE_VERSION, runs: [] };

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
      if (
        data === null ||
        typeof data !== 'object' ||
        (data as { version?: unknown }).version !== SAVE_VERSION ||
        !Array.isArray((data as { runs?: unknown }).runs)
      ) {
        if (data !== null) quarantine(metaFile);
        return EMPTY_META;
      }
      return data as MetaState;
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
