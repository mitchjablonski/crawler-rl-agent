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

  it('roundtrips a run mid event-result sub-phase (v6 shape)', () => {
    const store = createSaveStore(dir, () => 1_750_000_000_000);
    const state = {
      ...sampleRun(),
      phase: 'event' as const,
      event: {
        eventId: 'shrine-of-the-crawl',
        result: { applied: [{ kind: 'gainMaxHp' as const, amount: 6 }], rolled: false },
      },
    };
    store.saveRun(state);
    expect(store.loadRun()?.state).toEqual(state);
  });

  it('quarantines a pre-v6 (v5) save rather than half-loading the old event shape', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 5, savedAt: 1, state: { event: { eventId: 'x' } } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('quarantines a v6 save (no actHpRamp) rather than half-loading and crashing in combat', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 6, savedAt: 1, state: { event: null } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('quarantines a v7 save (no allowedUnlockIds) rather than half-loading (E2 bump)', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 7, savedAt: 1, state: { event: null } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('roundtrips a v8 run state carrying allowedUnlockIds', () => {
    const store = createSaveStore(dir, () => 1_750_000_000_000);
    const state = { ...sampleRun(), allowedUnlockIds: ['arc-warden', 'crawlers-resolve'] };
    store.saveRun(state);
    const loaded = store.loadRun();
    expect(loaded?.state).toEqual(state);
    expect(loaded?.state.allowedUnlockIds).toEqual(['arc-warden', 'crawlers-resolve']);
  });

  it('quarantines a v8 save (no stats) rather than half-loading (#25 bump)', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 8, savedAt: 1, state: { event: null } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('quarantines a v9 save (no eventLoseHpMult) rather than half-loading (#34 bump)', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 9, savedAt: 1, state: { event: null } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('roundtrips a v9 run state carrying run stats', () => {
    const store = createSaveStore(dir, () => 1_750_000_000_000);
    const state = {
      ...sampleRun(),
      stats: { turns: 7, damageDealt: 42, damageTaken: 13, enemiesSlain: 3 },
    };
    store.saveRun(state);
    const loaded = store.loadRun();
    expect(loaded?.state).toEqual(state);
    expect(loaded?.state.stats).toEqual({
      turns: 7,
      damageDealt: 42,
      damageTaken: 13,
      enemiesSlain: 3,
    });
  });

  it('quarantines a v10 save (pre-#49 shop shape) rather than half-loading (#49 bump)', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ version: 10, savedAt: 1, state: { event: null } }),
    );
    expect(store.loadRun()).toBeNull();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('run.json.corrupt-'))).toBe(true);
  });

  it('roundtrips a v11 run state carrying shop removeUsed (#49)', () => {
    const store = createSaveStore(dir, () => 1_750_000_000_000);
    const state = {
      ...sampleRun(),
      phase: 'shop' as const,
      shop: {
        stock: [{ cardId: 'shield-wall', price: 50, sold: false }],
        potionStock: [],
        removeUsed: true,
      },
    };
    store.saveRun(state);
    const loaded = store.loadRun();
    expect(loaded?.state).toEqual(state);
    expect(loaded?.state.shop?.removeUsed).toBe(true);
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

  it('roundtrips E2 run records carrying difficulty/mode/character', () => {
    const store = createSaveStore(dir);
    store.recordRun({
      seed: 'win',
      outcome: 'victory',
      endedAt: '2026-06-24T00:00:00Z',
      difficulty: 'hard',
      mode: 'arc',
      character: 'knight',
    });
    const r = store.loadMeta().runs[0];
    expect(r?.difficulty).toBe('hard');
    expect(r?.mode).toBe('arc');
    expect(r?.character).toBe('knight');
  });

  it('roundtrips E3 daily run records (daily date + score) without a save bump', () => {
    const store = createSaveStore(dir);
    store.recordRun({
      seed: 'daily-2026-06-24',
      outcome: 'victory',
      endedAt: '2026-06-24T00:00:00Z',
      daily: '2026-06-24',
      score: 1234,
    });
    // An old-shape record without daily/score still loads alongside it.
    store.recordRun({ seed: 'old', outcome: 'defeat', endedAt: '2026-06-23T00:00:00Z' });
    const runs = store.loadMeta().runs;
    expect(runs[0]?.daily).toBe('2026-06-24');
    expect(runs[0]?.score).toBe(1234);
    expect(runs[1]?.daily).toBeUndefined();
    expect(runs[1]?.score).toBeUndefined();
  });

  it('#28: pre-#28 score-less history migrates (loads) and carries no score', () => {
    const store = createSaveStore(dir);
    // An old meta whose records predate the per-run score field.
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({
        version: 2,
        runs: [
          { seed: 'old', outcome: 'victory', endedAt: '2026-01-01T00:00:00Z', character: 'knight', mode: 'single' },
        ],
      }),
    );
    const before = store.loadMeta();
    // Migrated, not wiped or quarantined; the legacy record has no score.
    expect(before.runs).toHaveLength(1);
    expect(before.runs[0]?.score).toBeUndefined();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('meta.json.corrupt-'))).toBe(false);
    // A new (#28) record carries a score and the old one survives.
    store.recordRun({
      seed: 'new',
      outcome: 'defeat',
      endedAt: '2026-06-24T00:00:00Z',
      character: 'knight',
      mode: 'single',
      score: 777,
    });
    const after = store.loadMeta().runs;
    expect(after).toHaveLength(2);
    expect(after[0]?.score).toBeUndefined();
    expect(after[1]?.score).toBe(777);
  });

  // INVARIANT #2: run history MUST survive a save-version bump. Meta is versioned
  // separately from in-progress runs and migrated (never quarantined) on a delta.
  it('preserves run history written under an OLD meta version (no quarantine)', () => {
    const store = createSaveStore(dir);
    // Simulate a meta file from before this version (e.g. version 1, no extra
    // fields on records — exactly the pre-E2 shape).
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({
        version: 1,
        runs: [
          { seed: 'old-1', outcome: 'victory', endedAt: '2026-01-01T00:00:00Z' },
          { seed: 'old-2', outcome: 'defeat', endedAt: '2026-01-02T00:00:00Z' },
        ],
        settings: { snarkLevel: 2 },
      }),
    );
    const meta = store.loadMeta();
    // Run history is intact — NOT wiped or quarantined.
    expect(meta.runs).toHaveLength(2);
    expect(meta.runs[0]?.seed).toBe('old-1');
    expect(meta.runs[1]?.outcome).toBe('defeat');
    // Settings carry through, version normalizes forward, and the file remains.
    expect(meta.settings?.snarkLevel).toBe(2);
    expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('meta.json.corrupt-'))).toBe(false);
    // And appending a new (E2-shaped) record keeps the old ones.
    store.recordRun({ seed: 'new', outcome: 'victory', endedAt: '2026-06-24T00:00:00Z', difficulty: 'hard' });
    expect(store.loadMeta().runs).toHaveLength(3);
  });

  it('drops only malformed records, keeping the valid ones', () => {
    const store = createSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({
        version: 1,
        runs: [
          { seed: 'good', outcome: 'victory', endedAt: '2026-01-01T00:00:00Z' },
          { garbage: true },
          null,
          { seed: 'good2', outcome: 'defeat', endedAt: '2026-01-02T00:00:00Z' },
        ],
      }),
    );
    const runs = store.loadMeta().runs;
    expect(runs.map((r) => r.seed)).toEqual(['good', 'good2']);
  });
});
