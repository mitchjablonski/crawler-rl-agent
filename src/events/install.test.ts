import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOOK_TYPES, commandFor, installHooks, removeHooks } from './install.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-install-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const settingsPath = () => path.join(dir, '.claude', 'settings.json');

const readSettings = () =>
  JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as {
    hooks?: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    [key: string]: unknown;
  };

/** Mimics a project already using deepPairing hooks plus unrelated settings. */
function writeDeepPairingFixture() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify(
      {
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          PostToolUse: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'node .deeppairing/hooks/checkpoint.mjs' }],
            },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'node .deeppairing/hooks/stop.mjs' }] }],
        },
      },
      null,
      2,
    ),
  );
}

describe('installHooks', () => {
  it('creates settings.json from scratch with all five hooks', () => {
    const result = installHooks(dir);
    expect(result.changed).toBe(true);
    const settings = readSettings();
    for (const type of HOOK_TYPES) {
      const commands = (settings.hooks?.[type] ?? []).flatMap((g) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toContain(commandFor(type));
    }
  });

  it('merges alongside existing deepPairing hooks without touching them', () => {
    writeDeepPairingFixture();
    installHooks(dir);
    const settings = readSettings();

    const postCommands = (settings.hooks?.['PostToolUse'] ?? []).flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    expect(postCommands).toContain('node .deeppairing/hooks/checkpoint.mjs');
    expect(postCommands).toContain('ccc hook PostToolUse');

    const stopCommands = (settings.hooks?.['Stop'] ?? []).flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    expect(stopCommands).toContain('node .deeppairing/hooks/stop.mjs');
    expect(stopCommands).toContain('ccc hook Stop');

    expect(settings['permissions']).toEqual({ allow: ['Bash(npm test)'] });
  });

  it('is idempotent', () => {
    installHooks(dir);
    const once = fs.readFileSync(settingsPath(), 'utf8');
    const second = installHooks(dir);
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(once);
  });

  it('refuses to touch malformed settings', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ broken json');
    expect(() => installHooks(dir)).toThrow(/not valid JSON/);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ broken json');
  });
});

describe('removeHooks', () => {
  it('removes only our hooks, leaving deepPairing intact', () => {
    writeDeepPairingFixture();
    installHooks(dir);
    const result = removeHooks(dir);
    expect(result.changed).toBe(true);

    const settings = readSettings();
    const allCommands = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((g) => g.hooks.map((h) => h.command));
    expect(allCommands).toContain('node .deeppairing/hooks/checkpoint.mjs');
    expect(allCommands).toContain('node .deeppairing/hooks/stop.mjs');
    expect(allCommands.some((c) => c.startsWith('ccc hook '))).toBe(false);
    expect(settings.hooks?.['SessionStart']).toBeUndefined(); // emptied groups pruned
  });

  it('is a no-op when nothing of ours is installed', () => {
    writeDeepPairingFixture();
    const before = fs.readFileSync(settingsPath(), 'utf8');
    const result = removeHooks(dir);
    expect(result.changed).toBe(false);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(before);
  });
});
