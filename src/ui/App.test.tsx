import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { MetaSettings, MetaState, RunRecord, SaveStore } from '../persistence/saves.js';
import type { RunState } from '../engine/types.js';
import type { HookRecord } from '../events/types.js';
import type { TailerOptions } from '../events/tailer.js';
import type { DungeonAi } from '../ai/dungeonAi.js';

function memoryStore(savedAt = 0) {
  let run: RunState | null = null;
  const runs: RunRecord[] = [];
  let settings: MetaSettings = {};
  let saveCount = 0;
  const store: SaveStore = {
    loadRun: () => (run ? { state: run, savedAt } : null),
    saveRun: (state) => {
      run = state;
      saveCount++;
    },
    clearRun: () => {
      run = null;
    },
    loadMeta: (): MetaState => ({ version: 1, runs, settings }),
    recordRun: (record) => {
      runs.push(record);
    },
    updateSettings: (next) => {
      settings = { ...settings, ...next };
    },
  };
  return {
    store,
    get saveCount() {
      return saveCount;
    },
    get runs() {
      return runs;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

/** Render and wait one tick so useInput's effect has subscribed to stdin. */
async function renderApp(element: Parameters<typeof render>[0]) {
  const instance = render(element);
  await tick();
  return instance;
}

const deps = (mem: ReturnType<typeof memoryStore>) => ({
  store: mem.store,
  seed: 'ui-test',
  now: () => 0,
});

describe('App', () => {
  it('boots to the title; new run reaches the map and autosaves', async () => {
    const mem = memoryStore();
    const { lastFrame, stdin } = await renderApp(<App deps={deps(mem)} />);
    expect(lastFrame()).toContain('CLAUDE CODE CRAWLER');
    expect(lastFrame()).not.toContain('[c] Continue');

    stdin.write('n');
    await tick();
    expect(lastFrame()).toContain('Choose your path');
    expect(mem.saveCount).toBeGreaterThan(0);
  });

  it('walks into combat and plays a card', async () => {
    const mem = memoryStore();
    const { lastFrame, stdin } = await renderApp(<App deps={deps(mem)} />);
    stdin.write('n');
    await tick();
    stdin.write('1'); // row 1 is always combat
    await tick();
    expect(lastFrame()).toContain('EN 3/3');
    expect(lastFrame()).toContain('Your hand:');
    expect(lastFrame()).toContain('next:'); // enemy intent visible

    stdin.write('1'); // starter cards all cost 1; single enemy auto-targets
    await tick();
    expect(lastFrame()).toContain('EN 2/3');
  });

  it('offers continue when a save exists and resumes it', async () => {
    const mem = memoryStore();
    mem.store.saveRun(createRun(content, 'resume-me', DEFAULT_RUN_CONFIG));
    const { lastFrame, stdin } = await renderApp(<App deps={deps(mem)} />);
    expect(lastFrame()).toContain('[c] Continue');

    stdin.write('c');
    await tick();
    expect(lastFrame()).toContain('Choose your path');
  });
});

function fakeSource() {
  let handler: ((record: HookRecord) => void) | null = null;
  const create = (opts: TailerOptions) => {
    handler = opts.onRecord;
    return { start: () => {}, stop: () => {}, poll: () => {} };
  };
  const emit = (record: HookRecord) => handler?.(record);
  return { create, emit };
}

const hookRec = (hookType: string, payload: Record<string, unknown> = {}): HookRecord => ({
  hookType,
  receivedAt: 't',
  payload,
});

describe('App with hook events', () => {
  it('flips the link indicator and grants bounded gold at the map', async () => {
    const mem = memoryStore();
    const src = fakeSource();
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create }} />,
    );
    stdin.write('n');
    await tick();
    expect(lastFrame()).toContain('dungeon: dormant');

    src.emit(
      hookRec('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { exitCode: 0 },
      }),
    );
    await tick();
    expect(lastFrame()).toContain('dungeon: linked');
    expect(lastFrame()).toMatch(/(6[5-9]|7[0-5])g/); // 50g start + big lootRoll 15-25
    expect(lastFrame()).toContain('coin purse');
  });

  it('pauses on claude_awaits_user and resumes with [p]', async () => {
    const mem = memoryStore();
    const src = fakeSource();
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create }} />,
    );
    stdin.write('n');
    await tick();

    src.emit(hookRec('Stop'));
    await tick();
    expect(lastFrame()).toContain('CLAUDE AWAITS YOUR COMMAND');

    src.emit(hookRec('PostToolUse', { tool_name: 'Read', tool_input: {} }));
    await tick();
    expect(lastFrame()).toContain('Claude is working again');

    stdin.write('p');
    await tick();
    expect(lastFrame()).toContain('Choose your path');
  });

  it('pings on deepPairing review requests', async () => {
    const mem = memoryStore();
    const src = fakeSource();
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create }} />,
    );
    stdin.write('n');
    await tick();

    src.emit(hookRec('PreToolUse', { tool_name: 'mcp__deeppairing__present_options' }));
    await tick();
    expect(lastFrame()).toContain('PAIR PARTNER AWAITS JUDGMENT');
  });

  it('cycles snark on the title and persists it', async () => {
    const mem = memoryStore();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: () => {},
      christen: () => {},
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), ai: fakeAi }} />,
    );
    expect(lastFrame()).toContain('announcer: fake-ai');
    expect(lastFrame()).toContain('Snark: wry');

    stdin.write('s');
    await tick();
    expect(lastFrame()).toContain('Snark: roast');
    expect(mem.store.loadMeta().settings?.snarkLevel).toBe(2);
  });

  it('cycles difficulty on the title and persists it', async () => {
    const mem = memoryStore();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: () => {},
      christen: () => {},
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(<App deps={{ ...deps(mem), ai: fakeAi }} />);
    expect(lastFrame()).toContain('Difficulty: Normal');

    stdin.write('d');
    await tick();
    expect(lastFrame()).toContain('Difficulty: Hard');
    expect(mem.store.loadMeta().settings?.difficulty).toBe('hard');
  });

  it('cycles run mode on the title and persists it', async () => {
    const mem = memoryStore();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: () => {},
      christen: () => {},
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(<App deps={{ ...deps(mem), ai: fakeAi }} />);
    expect(lastFrame()).toContain('Mode: Single session');

    stdin.write('m');
    await tick();
    expect(lastFrame()).toContain('Mode: Multi-act arc');
    expect(mem.store.loadMeta().settings?.runMode).toBe('arc');
  });

  it('cycles character class on the title and persists it', async () => {
    const mem = memoryStore();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: () => {},
      christen: () => {},
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(<App deps={{ ...deps(mem), ai: fakeAi }} />);
    expect(lastFrame()).toContain('Class: Knight');

    stdin.write('k');
    await tick();
    expect(lastFrame()).toContain('Class: Apothecary');
    expect(mem.store.loadMeta().settings?.character).toBe('apothecary');
  });

  it('retires stale runs as abandoned at startup (REQ-12)', async () => {
    const mem = memoryStore(0); // saved at t=0
    mem.store.saveRun(createRun(content, 'stale-run', DEFAULT_RUN_CONFIG));
    const twentyFiveHours = 25 * 60 * 60 * 1000;
    const { lastFrame } = await renderApp(
      <App deps={{ ...deps(mem), now: () => twentyFiveHours }} />,
    );
    expect(lastFrame()).not.toContain('[c] Continue');
    expect(mem.runs.some((r) => r.seed === 'stale-run' && r.outcome === 'abandoned')).toBe(
      true,
    );
  });

  it('lets the Dungeon AI upgrade the narration line', async () => {
    const mem = memoryStore();
    const src = fakeSource();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: (narrationCtx, onLine) => onLine(`AI says: ${narrationCtx.event.kind}`),
      christen: () => {},
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create, ai: fakeAi }} />,
    );
    stdin.write('n');
    await tick();
    src.emit(
      hookRec('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { exitCode: 0 },
      }),
    );
    await tick();
    expect(lastFrame()).toContain('AI says: tests_passed');
  });

  it('holds modifiers until a safe boundary when mid-combat', async () => {
    const mem = memoryStore();
    const src = fakeSource();
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create }} />,
    );
    stdin.write('n');
    await tick();
    stdin.write('1'); // into combat
    await tick();
    expect(lastFrame()).toContain('EN 3/3');

    src.emit(
      hookRec('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { exitCode: 0 },
      }),
    );
    await tick();
    expect(lastFrame()).toMatch(/\b50g\b/); // unchanged mid-combat
  });
});

describe('Tier 1 christening', () => {
  it('shows the christened elite in combat but never persists it', async () => {
    // Elites are gated to row >= 3, so preload a run standing on a row-2 node
    // that leads into a row >= 3 combat, then fire the failed build there.
    let base = createRun(content, 'christen-0', DEFAULT_RUN_CONFIG);
    let pred: string | undefined;
    let targetIdx = -1;
    for (let s = 0; s < 60 && pred === undefined; s++) {
      base = createRun(content, `christen-${s}`, DEFAULT_RUN_CONFIG);
      for (const node of Object.values(base.map.nodes)) {
        if (node.row !== 2) continue;
        const idx = node.next.findIndex((id) => {
          const n = base.map.nodes[id];
          return n?.kind === 'combat' && n.row >= 3;
        });
        if (idx >= 0) {
          pred = node.id;
          targetIdx = idx;
          break;
        }
      }
    }
    if (pred === undefined) throw new Error('no row-2 -> row-3 combat edge found');

    const mem = memoryStore();
    mem.store.saveRun({ ...base, currentNodeId: pred });
    const src = fakeSource();
    const fakeAi: DungeonAi = {
      backend: 'fake-ai',
      narrate: () => {},
      christen: (christenCtx, onName) =>
        onName(`${christenCtx.baseName} of the Broken Build`),
      spentUsd: () => 0,
    };
    const { lastFrame, stdin } = await renderApp(
      <App deps={{ ...deps(mem), createSource: src.create, ai: fakeAi }} />,
    );
    stdin.write('c'); // continue the preloaded run -> map at the row-2 node
    await tick();

    // Failing test queues the elite; drained at this map boundary -> christened.
    src.emit(
      hookRec('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { exitCode: 1 },
      }),
    );
    await tick();

    stdin.write(String(targetIdx + 1)); // descend into the row >= 3 combat
    await tick();
    expect(lastFrame()).toContain('of the Broken Build');

    // Tier 1 boundary: the christened name exists only in the UI registry.
    expect(JSON.stringify(mem.store.loadRun())).not.toContain('Broken Build');
  });
});
