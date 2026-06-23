import { describe, expect, it } from 'vitest';
import { limitFor, ruleFor } from './rules.js';
import type { GameEvent, GameEventKind } from '../events/types.js';

const ev = (kind: GameEventKind, detail?: string): GameEvent =>
  detail === undefined ? { kind, at: 't' } : { kind, at: 't', detail };

describe('ruleFor', () => {
  it('rewards passing tests and builds with loot rolls', () => {
    expect(ruleFor(ev('tests_passed')).modifier).toEqual({ kind: 'lootRoll', size: 'big' });
    expect(ruleFor(ev('build_passed')).modifier).toEqual({ kind: 'lootRoll', size: 'small' });
    expect(ruleFor(ev('tests_passed')).narration).toMatch(/coin/i);
  });

  it('punishes failures with a queued Lint Goblin', () => {
    expect(ruleFor(ev('tests_failed')).modifier).toEqual({
      kind: 'queueElite',
      enemyId: 'lint-goblin',
    });
    expect(ruleFor(ev('build_failed')).modifier).toEqual({
      kind: 'queueElite',
      enemyId: 'lint-goblin',
    });
  });

  it('maps support events', () => {
    expect(ruleFor(ev('agent_spawned')).modifier).toEqual({
      kind: 'blessNextCombat',
      status: 'strength',
      stacks: 1,
    });
    expect(ruleFor(ev('session_started')).modifier).toEqual({
      kind: 'healPlayer',
      amount: 10,
    });
    expect(ruleFor(ev('code_changed', 'run.ts')).narration).toContain('run.ts');
  });

  it('pause-flow and ambience kinds produce no modifier', () => {
    for (const kind of [
      'claude_awaits_user',
      'attention_required',
      'review_requested',
      'file_explored',
      'activity',
    ] as const) {
      expect(ruleFor(ev(kind))).toEqual({ modifier: null, narration: null });
    }
  });
});

describe('rule references', () => {
  it('queueElite rules reference enemies that exist in content', async () => {
    const { content } = await import('../engine/content/index.js');
    for (const kind of ['tests_failed', 'build_failed'] as const) {
      const outcome = ruleFor(ev(kind));
      if (outcome.modifier?.kind === 'queueElite') {
        expect(content.enemies[outcome.modifier.enemyId]).toBeDefined();
      }
    }
  });
});

describe('snark tiers', () => {
  it('narration differs per tier and defaults to wry', () => {
    const dry = ruleFor(ev('tests_passed'), 0).narration;
    const wry = ruleFor(ev('tests_passed'), 1).narration;
    const roast = ruleFor(ev('tests_passed'), 2).narration;
    expect(new Set([dry, wry, roast]).size).toBe(3);
    expect(ruleFor(ev('tests_passed')).narration).toBe(wry);
  });

  it('mechanics are identical across tiers', () => {
    for (const snark of [0, 1, 2] as const) {
      expect(ruleFor(ev('build_failed'), snark).modifier).toEqual({
        kind: 'queueElite',
        enemyId: 'lint-goblin',
      });
    }
  });
});

describe('limitFor', () => {
  it('has per-kind configs with a default fallback', () => {
    expect(limitFor('code_changed').capacity).toBe(2);
    expect(limitFor('something_unknown')).toEqual({ capacity: 3, refillPerMinute: 1 });
  });
});
