import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTailer } from './tailer.js';
import type { HookRecord } from './types.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-tail-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const line = (hookType: string, n: number) =>
  `${JSON.stringify({ hookType, receivedAt: `t${n}`, payload: {} })}\n`;

function collector() {
  const records: HookRecord[] = [];
  return { records, onRecord: (r: HookRecord) => records.push(r) };
}

describe('createTailer', () => {
  it('skips pre-attach content by default and emits new lines', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, line('Old', 1));
    const { records, onRecord } = collector();
    const tailer = createTailer({ eventsDir: dir, onRecord });

    tailer.poll(); // attaches at end of existing content
    expect(records).toHaveLength(0);

    fs.appendFileSync(file, line('PostToolUse', 2) + line('Stop', 3));
    tailer.poll();
    expect(records.map((r) => r.hookType)).toEqual(['PostToolUse', 'Stop']);

    tailer.poll(); // nothing new
    expect(records).toHaveLength(2);
  });

  it('buffers partial lines until completed and skips garbage', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, '');
    const { records, onRecord } = collector();
    const tailer = createTailer({ eventsDir: dir, onRecord });
    tailer.poll();

    const full = line('PostToolUse', 1);
    fs.appendFileSync(file, full.slice(0, 10)); // partial write
    tailer.poll();
    expect(records).toHaveLength(0);

    fs.appendFileSync(file, full.slice(10) + 'garbage not json\n' + line('Stop', 2));
    tailer.poll();
    expect(records.map((r) => r.hookType)).toEqual(['PostToolUse', 'Stop']);
  });

  it('switches to a newer session file and reads it from the start', () => {
    const oldFile = path.join(dir, 'old.jsonl');
    fs.writeFileSync(oldFile, line('Old', 1));
    fs.utimesSync(oldFile, new Date(1000), new Date(1000));

    const { records, onRecord } = collector();
    const tailer = createTailer({ eventsDir: dir, onRecord });
    tailer.poll();

    const newFile = path.join(dir, 'new.jsonl');
    fs.writeFileSync(newFile, line('SessionStart', 2));
    fs.utimesSync(newFile, new Date(2000000000000), new Date(2000000000000));
    tailer.poll();
    expect(records.map((r) => r.hookType)).toEqual(['SessionStart']);
  });

  it('tolerates a missing events directory', () => {
    const { records, onRecord } = collector();
    const tailer = createTailer({ eventsDir: path.join(dir, 'nope'), onRecord });
    expect(() => tailer.poll()).not.toThrow();
    expect(records).toHaveLength(0);
  });
});
