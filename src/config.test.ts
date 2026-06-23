import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';

const base = { argv: [] as string[], env: {}, homedir: '/home/crawler' };

describe('resolveConfig', () => {
  it('falls back to defaults', () => {
    const config = resolveConfig(base);
    expect(config.saveDir).toBe('/home/crawler/.claude-code-crawler');
    expect(config.seed).toBeUndefined();
    expect(config.snarkLevel).toBeUndefined(); // unset → in-game setting decides
    expect(config.apiKey).toBeUndefined();
    expect(config.aiProvider).toBeUndefined();
    expect(config.aiBudgetUsd).toBe(0.05);
    expect(config.aiTranscript).toBe(false);
  });

  it('prefers flags over env over defaults', () => {
    const config = resolveConfig({
      argv: ['--save-dir', '/flag/dir', '--seed=flagseed', '--api-key', 'flagkey'],
      env: {
        CCC_SAVE_DIR: '/env/dir',
        CCC_SEED: 'envseed',
        CCC_SNARK: '2',
        CCC_API_KEY: 'envkey',
        ANTHROPIC_API_KEY: 'anthkey',
      },
      homedir: '/home/crawler',
    });
    expect(config.saveDir).toBe('/flag/dir');
    expect(config.seed).toBe('flagseed');
    expect(config.snarkLevel).toBe(2); // env wins when no flag
    expect(config.apiKey).toBe('flagkey');
  });

  it('CCC_API_KEY outranks ANTHROPIC_API_KEY', () => {
    const config = resolveConfig({
      ...base,
      env: { CCC_API_KEY: 'ccc', ANTHROPIC_API_KEY: 'anth' },
    });
    expect(config.apiKey).toBe('ccc');
  });

  it('treats invalid snark levels as unset', () => {
    expect(resolveConfig({ ...base, env: { CCC_SNARK: '7' } }).snarkLevel).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_SNARK: 'spicy' } }).snarkLevel).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_SNARK: '0' } }).snarkLevel).toBe(0);
  });

  it('parses AI fields with validation', () => {
    const config = resolveConfig({
      ...base,
      env: {
        CCC_AI_PROVIDER: 'claude-cli',
        CCC_AI_BASE_URL: 'http://localhost:1234',
        CCC_AI_MODEL: 'm',
        CCC_AI_BUDGET: '0.10',
        CCC_AI_TRANSCRIPT: '1',
      },
    });
    expect(config.aiProvider).toBe('claude-cli');
    expect(config.aiBaseUrl).toBe('http://localhost:1234');
    expect(config.aiModel).toBe('m');
    expect(config.aiBudgetUsd).toBeCloseTo(0.1);
    expect(config.aiTranscript).toBe(true);

    expect(resolveConfig({ ...base, env: { CCC_AI_PROVIDER: 'skynet' } }).aiProvider).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_AI_BUDGET: '-3' } }).aiBudgetUsd).toBe(0.05);
  });

  it('parses difficulty with validation', () => {
    expect(resolveConfig(base).difficulty).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_DIFFICULTY: 'hard' } }).difficulty).toBe('hard');
    expect(resolveConfig({ ...base, argv: ['--difficulty', 'nightmare'] }).difficulty).toBe('nightmare');
    expect(resolveConfig({ ...base, env: { CCC_DIFFICULTY: 'impossible' } }).difficulty).toBeUndefined();
  });

  it('passes character id through (validated by the UI)', () => {
    expect(resolveConfig(base).character).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_CHARACTER: 'apothecary' } }).character).toBe('apothecary');
    expect(resolveConfig({ ...base, argv: ['--character', 'knight'] }).character).toBe('knight');
  });

  it('parses run mode with validation', () => {
    expect(resolveConfig(base).runMode).toBeUndefined();
    expect(resolveConfig({ ...base, env: { CCC_MODE: 'arc' } }).runMode).toBe('arc');
    expect(resolveConfig({ ...base, argv: ['--mode', 'single'] }).runMode).toBe('single');
    expect(resolveConfig({ ...base, env: { CCC_MODE: 'endless' } }).runMode).toBeUndefined();
  });

  it('parses the run TTL with validation', () => {
    expect(resolveConfig(base).runTtlHours).toBe(24);
    expect(resolveConfig({ ...base, env: { CCC_RUN_TTL_HOURS: '48' } }).runTtlHours).toBe(48);
    expect(resolveConfig({ ...base, env: { CCC_RUN_TTL_HOURS: '-1' } }).runTtlHours).toBe(24);
    expect(resolveConfig({ ...base, env: { CCC_RUN_TTL_HOURS: 'soon' } }).runTtlHours).toBe(24);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolveConfig(base))).toBe(true);
  });
});
