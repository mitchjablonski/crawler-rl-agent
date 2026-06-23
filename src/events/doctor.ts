import fs from 'node:fs';
import path from 'node:path';
import { HOOK_TYPES, commandFor } from './install.js';

export interface DoctorReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export function runDoctor(
  projectDir: string,
  eventsDir: string,
  base = 'ccc',
  now: () => number = Date.now,
): DoctorReport {
  const lines: string[] = [];
  let ok = true;

  // Hook installation.
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  let settings: { hooks?: Record<string, unknown> } | null = null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, unknown>;
    };
  } catch {
    settings = null;
  }

  const ourCommands = new Set(HOOK_TYPES.map((t) => commandFor(t, base)));
  let oursInstalled = 0;
  let foreign = 0;
  for (const groups of Object.values(settings?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const cmds = (group as { hooks?: { command?: string }[] }).hooks ?? [];
      for (const cmd of cmds) {
        if (cmd.command !== undefined && ourCommands.has(cmd.command)) oursInstalled++;
        else foreign++;
      }
    }
  }
  if (oursInstalled >= HOOK_TYPES.length) {
    lines.push(`[ok] crawler hooks installed (${oursInstalled}/${HOOK_TYPES.length})`);
  } else {
    ok = false;
    lines.push(
      `[!!] crawler hooks incomplete (${oursInstalled}/${HOOK_TYPES.length}) - run: ${base} init`,
    );
  }
  if (foreign > 0) {
    lines.push(`[ok] ${foreign} other hook(s) present and untouched (coexisting)`);
  }

  // Event flow.
  let newest: { file: string; mtime: number; size: number } | null = null;
  try {
    for (const name of fs.readdirSync(eventsDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(eventsDir, name);
      const stat = fs.statSync(full);
      if (!newest || stat.mtimeMs > newest.mtime) {
        newest = { file: name, mtime: stat.mtimeMs, size: stat.size };
      }
    }
  } catch {
    // Missing dir handled below.
  }
  if (!newest) {
    ok = false;
    lines.push(
      `[!!] no session event files in ${eventsDir} - hooks have not fired yet (is a Claude Code session running in a hooked project?)`,
    );
  } else {
    const ageSec = Math.round((now() - newest.mtime) / 1000);
    lines.push(
      `[ok] newest session file: ${newest.file} (${newest.size} bytes, last event ${ageSec}s ago)`,
    );
  }

  return { ok, lines };
}
