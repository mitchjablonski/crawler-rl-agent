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

  it('maps lint and commit events to bounded modifiers', () => {
    expect(ruleFor(ev('lint_failed')).modifier).toEqual({
      kind: 'queueElite',
      enemyId: 'lint-goblin',
    });
    expect(ruleFor(ev('lint_passed')).modifier).toEqual({ kind: 'lootRoll', size: 'small' });
    expect(ruleFor(ev('committed')).modifier).toEqual({ kind: 'healPlayer', amount: 5 });
  });

  it('maps a git push to a bounded ship-it bless, distinct from commit', () => {
    expect(ruleFor(ev('pushed')).modifier).toEqual({
      kind: 'blessNextCombat',
      status: 'strength',
      stacks: 1,
    });
    // Push and commit are different rewards.
    expect(ruleFor(ev('pushed')).modifier).not.toEqual(ruleFor(ev('committed')).modifier);
    expect(ruleFor(ev('pushed')).narration).toMatch(/ship|push/i);
  });

  it('pushed narration differs per tier, mechanics identical', () => {
    const lines = [0, 1, 2].map((s) => ruleFor(ev('pushed'), s as 0 | 1 | 2).narration);
    expect(new Set(lines).size).toBe(3);
    for (const snark of [0, 1, 2] as const) {
      expect(ruleFor(ev('pushed'), snark).modifier).toEqual({
        kind: 'blessNextCombat',
        status: 'strength',
        stacks: 1,
      });
    }
  });

  it('gives lint_failed distinct narration from tests_failed', () => {
    expect(ruleFor(ev('lint_failed')).narration).not.toBe(ruleFor(ev('tests_failed')).narration);
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
    for (const kind of ['tests_failed', 'build_failed', 'lint_failed'] as const) {
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

  it('lint_passed narration differs per tier, mechanics identical', () => {
    const lines = [0, 1, 2].map((s) => ruleFor(ev('lint_passed'), s as 0 | 1 | 2).narration);
    expect(new Set(lines).size).toBe(3);
    for (const snark of [0, 1, 2] as const) {
      expect(ruleFor(ev('lint_passed'), snark).modifier).toEqual({
        kind: 'lootRoll',
        size: 'small',
      });
    }
  });
});

describe('limitFor', () => {
  it('has per-kind configs with a default fallback', () => {
    expect(limitFor('code_changed').capacity).toBe(2);
    expect(limitFor('lint_passed')).toEqual({ capacity: 1, refillPerMinute: 0.5 });
    expect(limitFor('lint_failed')).toEqual({ capacity: 2, refillPerMinute: 0.5 });
    expect(limitFor('committed')).toEqual({ capacity: 2, refillPerMinute: 0.5 });
    expect(limitFor('pushed')).toEqual({ capacity: 1, refillPerMinute: 0.25 });
    expect(limitFor('something_unknown')).toEqual({ capacity: 3, refillPerMinute: 1 });
  });
});
