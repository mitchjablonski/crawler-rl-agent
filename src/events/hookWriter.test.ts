import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeHookEvent } from './hookWriter.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-hooks-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const opts = () => ({ eventsDir: dir, now: () => 1_750_000_000_000 });

describe('writeHookEvent', () => {
  it('appends JSONL records keyed by session id', () => {
    const payload = JSON.stringify({ session_id: 'abc123', tool_name: 'Bash' });
    expect(writeHookEvent('PostToolUse', payload, opts())).toBe(true);
    expect(writeHookEvent('Stop', JSON.stringify({ session_id: 'abc123' }), opts())).toBe(true);

    const lines = fs
      .readFileSync(path.join(dir, 'abc123.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(first['hookType']).toBe('PostToolUse');
    expect(first['receivedAt']).toBe(new Date(1_750_000_000_000).toISOString());
    expect((first['payload'] as Record<string, unknown>)['tool_name']).toBe('Bash');
  });

  it('records garbage stdin with an empty payload under unknown', () => {
    expect(writeHookEvent('PostToolUse', 'not json at all', opts())).toBe(true);
    const lines = fs.readFileSync(path.join(dir, 'unknown.jsonl'), 'utf8').trim();
    const record = JSON.parse(lines) as Record<string, unknown>;
    expect(record['payload']).toEqual({});
  });

  it('sanitizes hostile session ids', () => {
    const payload = JSON.stringify({ session_id: '../../etc/passwd' });
    expect(writeHookEvent('Stop', payload, opts())).toBe(true);
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
    expect(files[0]).not.toContain('..');
  });

  it('returns false instead of throwing when the directory is unwritable', () => {
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, ''); // a file where a directory must go
    const result = writeHookEvent('Stop', '{}', { eventsDir: path.join(blocked, 'x') });
    expect(result).toBe(false);
  });
});
