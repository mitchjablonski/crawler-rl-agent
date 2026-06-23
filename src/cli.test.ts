import { describe, expect, it } from 'vitest';
import { USAGE, cliShortcut } from './cli-args.js';

describe('cliShortcut', () => {
  it('detects help in all its forms', () => {
    expect(cliShortcut(['--help'])).toBe('help');
    expect(cliShortcut(['-h'])).toBe('help');
    expect(cliShortcut(['help'])).toBe('help');
    expect(cliShortcut(['doctor', '--help'])).toBe('help');
  });

  it('detects version', () => {
    expect(cliShortcut(['--version'])).toBe('version');
    expect(cliShortcut(['-v'])).toBe('version');
  });

  it('returns null for normal commands so dispatch proceeds', () => {
    expect(cliShortcut([])).toBeNull();
    expect(cliShortcut(['play'])).toBeNull();
    expect(cliShortcut(['simulate', 'busy-refactor'])).toBeNull();
    expect(cliShortcut(['--seed', 'abc'])).toBeNull();
  });
});

describe('USAGE', () => {
  it('carries the non-affiliation disclaimer', () => {
    expect(USAGE).toContain('Not affiliated');
    expect(USAGE).toContain('trademarks of Anthropic');
  });

  it('lists every command', () => {
    for (const cmd of ['play', 'init', 'doctor', 'simulate', 'hook']) {
      expect(USAGE).toContain(cmd);
    }
  });
});
