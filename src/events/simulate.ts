import fs from 'node:fs';
import path from 'node:path';
import type { HookRecord } from './types.js';

export interface TimedRecord {
  readonly atMs: number;
  readonly record: HookRecord;
}

export const SCENARIOS = ['busy-refactor', 'review-time', 'quiet-session'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export function isScenario(name: string): name is ScenarioName {
  return (SCENARIOS as readonly string[]).includes(name);
}

/** Pure: produce the timed records for a named scenario. */
export function scenarioRecords(name: ScenarioName, startAt: number): TimedRecord[] {
  const rec = (
    atMs: number,
    hookType: string,
    payload: Record<string, unknown> = {},
  ): TimedRecord => ({
    atMs,
    record: {
      hookType,
      receivedAt: new Date(startAt + atMs).toISOString(),
      payload: { session_id: `sim-${name}`, ...payload },
    },
  });
  const bash = (command: string, exitCode: number) => ({
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exitCode },
  });
  const edit = (file_path: string) => ({ tool_name: 'Edit', tool_input: { file_path } });

  switch (name) {
    case 'busy-refactor':
      return [
        rec(0, 'SessionStart'),
        rec(2_000, 'PostToolUse', edit('src/engine/run.ts')),
        rec(4_000, 'PostToolUse', edit('src/engine/combat.ts')),
        rec(6_000, 'PostToolUse', bash('npm test', 1)),
        rec(9_000, 'PostToolUse', edit('src/engine/combat.ts')),
        rec(12_000, 'PostToolUse', bash('npm test', 0)),
        rec(15_000, 'PostToolUse', bash('npm run build', 0)),
        rec(18_000, 'PreToolUse', { tool_name: 'Task' }),
        rec(22_000, 'PostToolUse', bash('npm test', 0)),
        rec(26_000, 'Stop'),
      ];
    case 'review-time':
      return [
        rec(0, 'SessionStart'),
        rec(2_000, 'PostToolUse', edit('src/api/auth.ts')),
        rec(5_000, 'PreToolUse', { tool_name: 'mcp__deeppairing__present_code_change' }),
        rec(12_000, 'PostToolUse', edit('src/api/auth.ts')),
        rec(15_000, 'Stop'),
      ];
    case 'quiet-session':
      return [
        rec(0, 'SessionStart'),
        rec(3_000, 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'README.md' } }),
        rec(6_000, 'PostToolUse', edit('README.md')),
        rec(10_000, 'Stop'),
      ];
  }
}

/** Replay a recorded session JSONL at a fixed pace under a fresh session id. */
export function loadReplay(file: string, startAt: number, paceMs = 1500): TimedRecord[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out: TimedRecord[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as HookRecord;
      if (typeof parsed.hookType !== 'string') continue;
      const atMs = out.length * paceMs;
      out.push({
        atMs,
        record: {
          ...parsed,
          receivedAt: new Date(startAt + atMs).toISOString(),
          payload: { ...parsed.payload, session_id: 'sim-replay' },
        },
      });
    } catch {
      // Garbage line: skip.
    }
  }
  return out;
}

/** Append records to the events dir on schedule; a running game tails them live. */
export async function runSimulation(
  records: readonly TimedRecord[],
  eventsDir: string,
  log: (message: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  fs.mkdirSync(eventsDir, { recursive: true });
  let elapsed = 0;
  for (const { atMs, record } of records) {
    await sleep(Math.max(0, atMs - elapsed));
    elapsed = atMs;
    const sessionId = String(record.payload['session_id'] ?? 'sim').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    fs.appendFileSync(path.join(eventsDir, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`);
    const tool = record.payload['tool_name'];
    log(`[${(atMs / 1000).toFixed(1)}s] ${record.hookType}${tool ? ` ${String(tool)}` : ''}`);
  }
  log('simulation complete');
}
