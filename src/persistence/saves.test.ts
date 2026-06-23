import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSaveStore } from './saves.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-saves-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sampleRun = () => createRun(content, 'save-test', DEFAULT_RUN_CONFIG);

describe('run saves', () => {
  it('roundtrips a run state exactly, stamped with savedAt', () => {
    const store = createSaveStore(dir, () => 1_750_000_000_000);
    const state = sampleRun();
    store.saveRun(state);
    const loaded = store.loadRun();
    expect(loaded?.state).toEqual(state);
    expect(loaded?.savedAt).toBe(1_750_000_000_000);
  });

  it('returns null when no save exists, and after clearRun', () => {
    const store = createSaveStore(dir);
    expect(store.loadRun()).toBeNull();
    store.saveRun(sampleRun());
    store.clearRun();
    expect(store.loadRun()).toBeNull();
    store.clearRun(); // idempotent
  });

  it('quarantines unparseable saves and keeps working', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'run.json'), '{ not json !!!');
    expect(store.loadRun()).toBeNull();
    const entries = fs.readdirSync(dir);
    expect(entries.some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
    expect(entries).not.toContain('run.json');
    store.saveRun(sampleRun());
    expect(store.loadRun()).not.toBeNull();
  });

  it('quarantines wrong-shaped and pre-TTL saves', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ version: 999 }));
    expect(store.loadRun()).toBeNull();
    // A v2-era save without savedAt also quarantines rather than half-loads.
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ version: 3, state: {} }));
    expect(store.loadRun()).toBeNull();
    // (Same-millisecond quarantines may collide on filename; at least one survives.)
    expect(
      fs.readdirSync(dir).filter((f) => f.startsWith('run.json.corrupt-')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(fs.readdirSync(dir)).not.toContain('run.json');
  });

  it('leaves no temp files behind', () => {
    const store = createSaveStore(dir);
    store.saveRun(sampleRun());
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });
});

describe('meta progression', () => {
  it('starts empty and appends run records', () => {
    const store = createSaveStore(dir);
    expect(store.loadMeta().runs).toHaveLength(0);
    store.recordRun({ seed: 'a', outcome: 'victory', endedAt: '2026-06-10T00:00:00Z' });
    store.recordRun({ seed: 'b', outcome: 'defeat', endedAt: '2026-06-10T01:00:00Z' });
    const meta = store.loadMeta();
    expect(meta.runs).toHaveLength(2);
    expect(meta.runs[0]?.seed).toBe('a');
    expect(meta.runs[1]?.outcome).toBe('defeat');
  });

  it('quarantines corrupt meta and returns defaults', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'meta.json'), 'garbage');
    expect(store.loadMeta().runs).toHaveLength(0);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('meta.json.corrupt-'))).toBe(true);
  });

  it('persists settings without clobbering run history', () => {
    const store = createSaveStore(dir);
    store.recordRun({ seed: 'a', outcome: 'victory', endedAt: '2026-06-10T00:00:00Z' });
    store.updateSettings({ snarkLevel: 2 });
    const meta = store.loadMeta();
    expect(meta.settings?.snarkLevel).toBe(2);
    expect(meta.runs).toHaveLength(1);

    store.updateSettings({ snarkLevel: 0 });
    expect(store.loadMeta().settings?.snarkLevel).toBe(0);

    // difficulty persists alongside snark without clobbering it
    store.updateSettings({ difficulty: 'hard' });
    expect(store.loadMeta().settings?.difficulty).toBe('hard');
    expect(store.loadMeta().settings?.snarkLevel).toBe(0);
  });
});
