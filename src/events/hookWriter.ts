import fs from 'node:fs';
import path from 'node:path';

export interface HookWriteOptions {
  readonly eventsDir: string;
  readonly now?: () => number;
}

/**
 * Append one hook record to the session's JSONL file. NEVER throws — a hook
 * failure must never harm the host Claude Code session (REQ-3).
 */
export function writeHookEvent(
  hookType: string,
  rawStdin: string,
  opts: HookWriteOptions,
): boolean {
  try {
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rawStdin);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable stdin still records the hook firing.
    }
    const sessionId = sanitizeId(String(payload['session_id'] ?? 'unknown'));
    const record = {
      hookType,
      receivedAt: new Date((opts.now ?? Date.now)()).toISOString(),
      payload,
    };
    fs.mkdirSync(opts.eventsDir, { recursive: true });
    fs.appendFileSync(
      path.join(opts.eventsDir, `${sessionId}.jsonl`),
      `${JSON.stringify(record)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

function sanitizeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return clean.length > 0 ? clean : 'unknown';
}

/** Read all of stdin, but never hang: resolve with whatever arrived after 1s. */
export function readStdin(timeoutMs = 1000): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}
