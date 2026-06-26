import { describe, expect, it } from 'vitest';
import {
  dailySeed,
  dailyDate,
  dailyScore,
  bestDailyScore,
  runScore,
  bestRun,
  DAILY_DIFFICULTY,
  DAILY_MODE,
  DAILY_CHARACTER,
} from './daily.js';
import { createRun, type RunConfig } from '../engine/run.js';
import { content, CHARACTERS } from '../engine/content/index.js';
import { knobsFor, actsForMode } from '../config.js';
import type { RunState } from '../engine/types.js';
import type { MetaState, RunRecord } from '../persistence/saves.js';

// 2026-06-24T13:45:00Z — a fixed instant well inside the UTC day.
const MS = Date.UTC(2026, 5, 24, 13, 45, 0);

describe('dailySeed / dailyDate', () => {
  it('returns daily-YYYY-MM-DD using the UTC date', () => {
    expect(dailyDate(MS)).toBe('2026-06-24');
    expect(dailySeed(MS)).toBe('daily-2026-06-24');
  });

  it('zero-pads month and day', () => {
    expect(dailyDate(Date.UTC(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
  });

  it('same ms → same seed; different day → different seed', () => {
    expect(dailySeed(MS)).toBe(dailySeed(MS));
    const nextDay = MS + 24 * 60 * 60 * 1000;
    expect(dailySeed(nextDay)).toBe('daily-2026-06-25');
    expect(dailySeed(nextDay)).not.toBe(dailySeed(MS));
  });

  it('uses UTC, not local time (late-UTC instant stays on its UTC day)', () => {
    // 23:30 UTC is still the 24th in UTC regardless of host timezone.
    expect(dailyDate(Date.UTC(2026, 5, 24, 23, 30, 0))).toBe('2026-06-24');
  });
});

describe('canonical daily config', () => {
  it('is the documented fixed values (normal / single / knight)', () => {
    expect(DAILY_DIFFICULTY).toBe('normal');
    expect(DAILY_MODE).toBe('single');
    expect(DAILY_CHARACTER).toBe('knight');
  });
});

function canonicalDailyConfig(): RunConfig {
  const k = knobsFor(DAILY_DIFFICULTY, DAILY_MODE);
  const cls = CHARACTERS[DAILY_CHARACTER]!;
  return {
    starterDeck: cls.starterDeck,
    startingRelics: cls.startingRelics,
    maxHp: cls.maxHp,
    startingGold: k.startingGold,
    enemyHpMult: k.enemyHpMult,
    ...(k.actHpRamp ? { actHpRamp: k.actHpRamp } : {}),
    acts: actsForMode(DAILY_MODE),
  };
}

describe('daily run determinism', () => {
  it('two runs from the same date seed + canonical config are identical', () => {
    const a = createRun(content, dailySeed(MS), canonicalDailyConfig());
    const b = createRun(content, dailySeed(MS), canonicalDailyConfig());
    expect(a).toEqual(b);
  });
});

// A minimal RunState shaped just enough for dailyScore.
function fakeState(over: Partial<RunState> & { row: number }): RunState {
  const { row, ...rest } = over;
  const base = {
    seed: 'daily-2026-06-24',
    map: { nodes: { here: { id: 'here', kind: 'combat', row, act: 0, next: [] } }, startId: 'here', bossId: 'here' },
    currentNodeId: 'here',
    phase: 'defeat',
    hp: 0,
    maxHp: 70,
    gold: 0,
    deck: [],
    relics: [],
  } as unknown as RunState;
  return { ...base, ...rest } as RunState;
}

describe('dailyScore', () => {
  it('is deterministic (same state → same score)', () => {
    const s = fakeState({ row: 4, hp: 30, gold: 80, relics: ['a', 'b'], phase: 'defeat' });
    expect(dailyScore(s)).toBe(dailyScore(s));
  });

  it('matches the documented formula', () => {
    // floors*50 + floor(gold*0.5) + hp + relics*25 + (won?500:0)
    const s = fakeState({ row: 4, hp: 30, gold: 80, relics: ['a', 'b'], phase: 'defeat' });
    expect(dailyScore(s)).toBe(4 * 50 + 40 + 30 + 2 * 25);
    const w = fakeState({ row: 4, hp: 30, gold: 80, relics: ['a', 'b'], phase: 'victory' });
    expect(dailyScore(w)).toBe(4 * 50 + 40 + 30 + 2 * 25 + 500);
  });

  it('a victory always outscores an otherwise-equal defeat', () => {
    const lose = fakeState({ row: 6, hp: 40, gold: 120, relics: ['a'], phase: 'defeat' });
    const win = fakeState({ row: 6, hp: 40, gold: 120, relics: ['a'], phase: 'victory' });
    expect(dailyScore(win)).toBeGreaterThan(dailyScore(lose));
  });

  it('is monotonic in depth, gold, hp, relics', () => {
    const base = fakeState({ row: 3, hp: 20, gold: 50, relics: ['a'], phase: 'defeat' });
    const deeper = fakeState({ row: 4, hp: 20, gold: 50, relics: ['a'], phase: 'defeat' });
    const richer = fakeState({ row: 3, hp: 20, gold: 60, relics: ['a'], phase: 'defeat' });
    const healthier = fakeState({ row: 3, hp: 30, gold: 50, relics: ['a'], phase: 'defeat' });
    const relicked = fakeState({ row: 3, hp: 20, gold: 50, relics: ['a', 'b'], phase: 'defeat' });
    const s = dailyScore(base);
    expect(dailyScore(deeper)).toBeGreaterThan(s);
    expect(dailyScore(richer)).toBeGreaterThan(s);
    expect(dailyScore(healthier)).toBeGreaterThan(s);
    expect(dailyScore(relicked)).toBeGreaterThan(s);
  });
});

describe('bestDailyScore', () => {
  const meta = (runs: readonly RunRecord[]): MetaState => ({ version: 2, runs });
  const rec = (r: Partial<RunRecord>): RunRecord => ({
    seed: 's',
    outcome: 'defeat',
    endedAt: '2026-06-24T00:00:00Z',
    ...r,
  });

  it('returns undefined when no daily for that date is recorded', () => {
    expect(bestDailyScore(meta([]), '2026-06-24')).toBeUndefined();
    expect(
      bestDailyScore(meta([rec({ daily: '2026-06-23', score: 100 })]), '2026-06-24'),
    ).toBeUndefined();
  });

  it('picks the max score among today\'s daily records', () => {
    const m = meta([
      rec({ daily: '2026-06-24', score: 100 }),
      rec({ daily: '2026-06-24', score: 350 }),
      rec({ daily: '2026-06-24', score: 200 }),
      rec({ daily: '2026-06-23', score: 999 }),
      rec({ score: 500 }), // non-daily record ignored
    ]);
    expect(bestDailyScore(m, '2026-06-24')).toBe(350);
  });

  it('ignores daily records that lack a score', () => {
    const m = meta([rec({ daily: '2026-06-24' }), rec({ daily: '2026-06-24', score: 42 })]);
    expect(bestDailyScore(m, '2026-06-24')).toBe(42);
  });
});

describe('runScore', () => {
  it('equals dailyScore (one shared scale) and is deterministic', () => {
    const s = fakeState({ row: 5, hp: 22, gold: 64, relics: ['a', 'b'], phase: 'victory' });
    expect(runScore(s)).toBe(dailyScore(s));
    expect(runScore(s)).toBe(runScore(s));
  });

  it('is monotonic in depth, gold, hp, relics, and rewards a win', () => {
    const base = fakeState({ row: 3, hp: 20, gold: 50, relics: ['a'], phase: 'defeat' });
    const s = runScore(base);
    expect(runScore(fakeState({ row: 4, hp: 20, gold: 50, relics: ['a'], phase: 'defeat' }))).toBeGreaterThan(s);
    expect(runScore(fakeState({ row: 3, hp: 20, gold: 60, relics: ['a'], phase: 'defeat' }))).toBeGreaterThan(s);
    expect(runScore(fakeState({ row: 3, hp: 30, gold: 50, relics: ['a'], phase: 'defeat' }))).toBeGreaterThan(s);
    expect(runScore(fakeState({ row: 3, hp: 20, gold: 50, relics: ['a', 'b'], phase: 'defeat' }))).toBeGreaterThan(s);
    expect(runScore(fakeState({ row: 3, hp: 20, gold: 50, relics: ['a'], phase: 'victory' }))).toBeGreaterThan(s);
  });
});

describe('bestRun', () => {
  const meta = (runs: readonly RunRecord[]): MetaState => ({ version: 2, runs });
  const rec = (r: Partial<RunRecord>): RunRecord => ({
    seed: 's',
    outcome: 'defeat',
    endedAt: '2026-06-24T00:00:00Z',
    ...r,
  });

  it('returns null when no matching run carries a score', () => {
    expect(bestRun(meta([]), { character: 'knight', mode: 'single' })).toBeNull();
    // matching character/mode but no score => not a best
    expect(
      bestRun(meta([rec({ character: 'knight', mode: 'single' })]), {
        character: 'knight',
        mode: 'single',
      }),
    ).toBeNull();
  });

  it('returns the max score among prior runs matching (character, mode)', () => {
    const m = meta([
      rec({ character: 'knight', mode: 'single', score: 400 }),
      rec({ character: 'knight', mode: 'single', score: 950 }),
      rec({ character: 'knight', mode: 'single', score: 700 }),
    ]);
    expect(bestRun(m, { character: 'knight', mode: 'single' })).toBe(950);
  });

  it('ignores records of a different character or mode', () => {
    const m = meta([
      rec({ character: 'knight', mode: 'single', score: 500 }),
      rec({ character: 'apothecary', mode: 'single', score: 9999 }), // other character
      rec({ character: 'knight', mode: 'arc', score: 8888 }), // other mode
    ]);
    expect(bestRun(m, { character: 'knight', mode: 'single' })).toBe(500);
  });

  it('treats pre-E2 score-less records as no best (migrate, not fake)', () => {
    // Old history: records without character/mode/score. They must not count.
    const m = meta([rec({ score: 123 }), rec({ outcome: 'victory' })]);
    expect(bestRun(m, { character: 'knight', mode: 'single' })).toBeNull();
    // ...but an undefined query DOES match the score-bearing legacy record.
    expect(bestRun(m, {})).toBe(123);
  });
});
