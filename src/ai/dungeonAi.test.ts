import { describe, expect, it } from 'vitest';
import { createDungeonAi, type NarrationContext } from './dungeonAi.js';
import type { CompletionClient } from './clients.js';

const ctx = (): NarrationContext => ({
  event: { kind: 'tests_passed', at: 't', detail: 'npm test' },
  staticLine: 'Tests passed. Gold.',
  snark: 2,
  run: { hp: 50, maxHp: 70, gold: 120, depth: 3 },
});

const fakeClient = (
  result: string | Promise<string>,
  costUsd = 0.001,
  timeoutMs = 50,
): CompletionClient => ({
  name: 'fake',
  timeoutMs,
  async complete() {
    return { text: await result, costUsd };
  },
});

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('createDungeonAi', () => {
  it('delivers a cleaned, clamped line', async () => {
    const ai = createDungeonAi({
      client: fakeClient('  "The dungeon mocks your green checkmarks."  \nextra'),
      budgetUsd: 1,
    });
    const lines: string[] = [];
    ai.narrate(ctx(), (l) => lines.push(l));
    await flush();
    expect(lines).toEqual(['The dungeon mocks your green checkmarks.']);

    const long = createDungeonAi({ client: fakeClient('x'.repeat(300)), budgetUsd: 1 });
    long.narrate(ctx(), (l) => lines.push(l));
    await flush();
    expect(lines[1]).toHaveLength(90);
    expect(lines[1]?.endsWith('...')).toBe(true);
  });

  it('stays silent on empty output and on client errors', async () => {
    const lines: string[] = [];
    const empty = createDungeonAi({ client: fakeClient('   \n  '), budgetUsd: 1 });
    empty.narrate(ctx(), (l) => lines.push(l));
    const failing = createDungeonAi({
      client: {
        name: 'fake',
        timeoutMs: 50,
        complete: () => Promise.reject(new Error('boom')),
      },
      budgetUsd: 1,
    });
    failing.narrate(ctx(), (l) => lines.push(l));
    await flush();
    expect(lines).toEqual([]);
  });

  it('times out slow clients silently', async () => {
    const never = new Promise<string>(() => {});
    const ai = createDungeonAi({ client: fakeClient(never, 0, 5), budgetUsd: 1 });
    const lines: string[] = [];
    ai.narrate(ctx(), (l) => lines.push(l));
    await new Promise((r) => setTimeout(r, 30));
    expect(lines).toEqual([]);
  });

  it('goes permanently static once the budget is spent', async () => {
    const ai = createDungeonAi({ client: fakeClient('line', 0.03), budgetUsd: 0.05 });
    const lines: string[] = [];
    ai.narrate(ctx(), (l) => lines.push(l)); // spends 0.03
    await flush();
    ai.narrate(ctx(), (l) => lines.push(l)); // spends 0.03 -> 0.06
    await flush();
    ai.narrate(ctx(), (l) => lines.push(l)); // over budget: blocked
    ai.narrate(ctx(), (l) => lines.push(l)); // still blocked
    await flush();
    expect(lines).toHaveLength(2);
    expect(ai.spentUsd()).toBeCloseTo(0.06);
  });

  it('is inert without a client and records transcripts with one', async () => {
    const entries: Record<string, unknown>[] = [];
    const inert = createDungeonAi({ client: null, budgetUsd: 1 });
    expect(inert.backend).toBe('static');
    inert.narrate(ctx(), () => {
      throw new Error('should never be called');
    });

    const ai = createDungeonAi({
      client: fakeClient('a line'),
      budgetUsd: 1,
      transcript: (e) => entries.push({ ...e }),
    });
    ai.narrate(ctx(), () => {});
    await flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.['kind']).toBe('narration');
    expect(String(entries[0]?.['prompt'])).toContain('tests_passed');
  });
});
