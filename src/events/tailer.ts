import fs from 'node:fs';
import path from 'node:path';
import type { HookRecord } from './types.js';

export interface TailerOptions {
  readonly eventsDir: string;
  readonly onRecord: (record: HookRecord) => void;
  readonly pollMs?: number;
  /** Start at the end of the first attached file (default true) so events from before launch don't replay. */
  readonly fromEnd?: boolean;
}

export interface Tailer {
  start(): void;
  stop(): void;
  /** Run one poll cycle synchronously (used by tests and start()). */
  poll(): void;
}

export function createTailer(options: TailerOptions): Tailer {
  const pollMs = options.pollMs ?? 500;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentFile: string | null = null;
  let offset = 0;
  let remainder = '';
  let firstAttach = true;

  function newestSessionFile(): string | null {
    let names: string[];
    try {
      names = fs.readdirSync(options.eventsDir);
    } catch {
      return null;
    }
    let best: string | null = null;
    let bestMtime = -1;
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(options.eventsDir, name);
      try {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > bestMtime) {
          bestMtime = mtime;
          best = full;
        }
      } catch {
        // File vanished between readdir and stat; skip.
      }
    }
    return best;
  }

  function attach(file: string): void {
    currentFile = file;
    remainder = '';
    if (firstAttach && options.fromEnd !== false) {
      try {
        offset = fs.statSync(file).size;
      } catch {
        offset = 0;
      }
    } else {
      // A session file discovered mid-run is fresh content: read it all.
      offset = 0;
    }
    firstAttach = false;
  }

  function poll(): void {
    const newest = newestSessionFile();
    if (!newest) return;
    if (newest !== currentFile) attach(newest);
    if (!currentFile) return;

    let size: number;
    try {
      size = fs.statSync(currentFile).size;
    } catch {
      return;
    }
    if (size < offset) {
      // Truncated/replaced in place: start over.
      offset = 0;
      remainder = '';
    }
    if (size === offset) return;

    let text: string;
    try {
      const fd = fs.openSync(currentFile, 'r');
      try {
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    offset = size;

    const lines = (remainder + text).split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          typeof (parsed as { hookType?: unknown }).hookType === 'string'
        ) {
          options.onRecord(parsed as HookRecord);
        }
      } catch {
        // Garbage line: skip, keep tailing.
      }
    }
  }

  return {
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, pollMs);
      timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    poll,
  };
}
