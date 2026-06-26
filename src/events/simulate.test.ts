import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isScenario, loadReplay, runSimulation, scenarioRecords } from './simulate.js';
import { classify } from './classify.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-sim-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('scenarioRecords', () => {
  it('busy-refactor drives the full modifier vocabulary', () => {
    const kinds = scenarioRecords('busy-refactor', 0).map((t) => classify(t.record).kind);
    expect(kinds).toContain('session_started');
    expect(kinds).toContain('code_changed');
    expect(kinds).toContain('tests_failed');
    expect(kinds).toContain('tests_passed');
    expect(kinds).toContain('build_passed');
    expect(kinds).toContain('agent_spawned');
    expect(kinds).toContain('claude_awaits_user');
  });

  it('lint-and-ship drives the new lint + commit vocabulary in order', () => {
    const records = scenarioRecords('lint-and-ship', 0);
    const kinds = records.map((t) => classify(t.record).kind);
    expect(kinds).toContain('lint_failed');
    expect(kinds).toContain('lint_passed');
    expect(kinds).toContain('committed');
    expect(kinds).toContain('pushed');
    // lint fail must precede lint pass, then the commit, then the push.
    expect(kinds.indexOf('lint_failed')).toBeLessThan(kinds.indexOf('lint_passed'));
    expect(kinds.indexOf('lint_passed')).toBeLessThan(kinds.indexOf('committed'));
    expect(kinds.indexOf('committed')).toBeLessThan(kinds.indexOf('pushed'));
    // Records ordered + session-tagged like the others.
    for (let i = 1; i < records.length; i++) {
      expect(records[i]!.atMs).toBeGreaterThan(records[i - 1]!.atMs);
    }
    expect(records[0]?.record.payload['session_id']).toBe('sim-lint-and-ship');
  });

  it('review-time produces the deepPairing ping', () => {
    const kinds = scenarioRecords('review-time', 0).map((t) => classify(t.record).kind);
    expect(kinds).toContain('review_requested');
  });

  it('records are ordered and session-tagged', () => {
    const records = scenarioRecords('quiet-session', 1000);
    for (let i = 1; i < records.length; i++) {
      expect(records[i]!.atMs).toBeGreaterThan(records[i - 1]!.atMs);
    }
    expect(records[0]?.record.payload['session_id']).toBe('sim-quiet-session');
  });

  it('isScenario guards names', () => {
    expect(isScenario('busy-refactor')).toBe(true);
    expect(isScenario('nonsense')).toBe(false);
  });
});

describe('loadReplay', () => {
  it('re-stamps, re-paces, and skips garbage', () => {
    const file = path.join(dir, 'recorded.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({ hookType: 'Stop', receivedAt: 'old', payload: { session_id: 'orig' } })}\n` +
        'garbage\n' +
        `${JSON.stringify({ hookType: 'SessionStart', receivedAt: 'old', payload: {} })}\n`,
    );
    const records = loadReplay(file, 5000, 100);
    expect(records).toHaveLength(2);
    expect(records[0]?.atMs).toBe(0);
    expect(records[1]?.atMs).toBe(100);
    expect(records[0]?.record.payload['session_id']).toBe('sim-replay');
    expect(records[0]?.record.receivedAt).toBe(new Date(5000).toISOString());
  });
});

describe('runSimulation', () => {
  it('writes records in order with a stubbed clock', async () => {
    const logs: string[] = [];
    const sleeps: number[] = [];
    await runSimulation(
      scenarioRecords('quiet-session', 0),
      dir,
      (m) => logs.push(m),
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    const lines = fs
      .readFileSync(path.join(dir, 'sim-quiet-session.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(4);
    expect(sleeps[0]).toBe(0);
    expect(sleeps.slice(1).every((ms) => ms > 0)).toBe(true);
    expect(logs[logs.length - 1]).toBe('simulation complete');
  });
});
