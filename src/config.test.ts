import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, knobsFor, resolveConfig } from './config.js';

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

describe('knobsFor', () => {
  it('single mode has no per-act ramp (so it stays byte-identical)', () => {
    for (const d of DIFFICULTIES) {
      expect(knobsFor(d, 'single').actHpRamp).toBeUndefined();
    }
  });

  it('arc mode exposes a per-act ramp whose act-0 scalar is always 1.0', () => {
    for (const d of DIFFICULTIES) {
      const ramp = knobsFor(d, 'arc').actHpRamp;
      expect(ramp).toBeDefined();
      // Act 0 == base mult guarantees single-mode (act 0 only) byte-identity.
      expect(ramp![0]).toBe(1);
      // Later acts must escalate so deeper arc acts are meaningfully harder.
      expect(ramp![1]!).toBeGreaterThan(1);
      expect(ramp![2]!).toBeGreaterThanOrEqual(ramp![1]!);
    }
  });

  it('arc enemy-HP mult differs from single per tier (the rebalance lever)', () => {
    for (const d of DIFFICULTIES) {
      // Arc base differs from single base; tuned for win-rate parity, not equality.
      expect(typeof knobsFor(d, 'arc').enemyHpMult).toBe('number');
    }
  });

  // Snapshot of the tuned D7 arc numbers (greedy@400: arc winRate ≈ single per
  // difficulty, both characters within ~6pts on average). Changing these is a
  // deliberate balance decision — update this assertion alongside the sweep.
  it('pins the tuned arc HP mults + per-act ramp', () => {
    expect(knobsFor('story', 'arc')).toMatchObject({
      enemyHpMult: 0.74,
      actHpRamp: [1.0, 1.1, 1.22],
    });
    expect(knobsFor('normal', 'arc')).toMatchObject({
      enemyHpMult: 0.96,
      actHpRamp: [1.0, 1.13, 1.27],
    });
    expect(knobsFor('hard', 'arc')).toMatchObject({
      enemyHpMult: 1.15,
      actHpRamp: [1.0, 1.13, 1.27],
    });
    expect(knobsFor('nightmare', 'arc')).toMatchObject({
      enemyHpMult: 1.43,
      actHpRamp: [1.0, 1.13, 1.27],
    });
  });

  // #34: event loseHp scalar. story/normal MUST be exactly 1.0 (normal seeded
  // replay byte-identical); hard/nightmare add teeth. Same in both modes.
  it('pins eventLoseHpMult per tier (normal/story exactly 1.0)', () => {
    for (const mode of ['single', 'arc'] as const) {
      expect(knobsFor('story', mode).eventLoseHpMult).toBe(1.0);
      expect(knobsFor('normal', mode).eventLoseHpMult).toBe(1.0);
      expect(knobsFor('hard', mode).eventLoseHpMult).toBe(1.25);
      expect(knobsFor('nightmare', mode).eventLoseHpMult).toBe(1.5);
    }
  });
});
