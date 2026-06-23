import fs from 'node:fs';
import path from 'node:path';

export const HOOK_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Notification',
  'SessionStart',
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** Events whose hook groups carry a tool matcher. */
const MATCHER_TYPES: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse']);

interface HookCommand {
  type: string;
  command?: string;
  [key: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}
type SettingsHooks = Record<string, HookGroup[] | undefined>;
interface Settings {
  hooks?: SettingsHooks;
  [key: string]: unknown;
}

export interface InstallResult {
  readonly changed: boolean;
  readonly settingsPath: string;
}

export function commandFor(type: HookType, base = 'ccc'): string {
  return `${base} hook ${type}`;
}

export function installHooks(projectDir: string, base = 'ccc'): InstallResult {
  const settingsPath = settingsFile(projectDir);
  const settings = readSettings(settingsPath);
  const hooks: SettingsHooks = { ...(settings.hooks ?? {}) };
  let changed = false;

  for (const type of HOOK_TYPES) {
    const command = commandFor(type, base);
    const groups = [...(hooks[type] ?? [])];
    const exists = groups.some((g) => (g.hooks ?? []).some((h) => h.command === command));
    if (exists) continue;
    groups.push(
      MATCHER_TYPES.has(type)
        ? { matcher: '*', hooks: [{ type: 'command', command }] }
        : { hooks: [{ type: 'command', command }] },
    );
    hooks[type] = groups;
    changed = true;
  }

  if (changed) writeSettings(settingsPath, { ...settings, hooks });
  return { changed, settingsPath };
}

export function removeHooks(projectDir: string, base = 'ccc'): InstallResult {
  const settingsPath = settingsFile(projectDir);
  const settings = readSettings(settingsPath);
  if (!settings.hooks) return { changed: false, settingsPath };

  const ours = new Set(HOOK_TYPES.map((t) => commandFor(t, base)));
  let changed = false;
  const hooks: SettingsHooks = {};

  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = (groups ?? [])
      .map((group) => {
        const filtered = (group.hooks ?? []).filter((h) => {
          const isOurs = h.command !== undefined && ours.has(h.command);
          if (isOurs) changed = true;
          return !isOurs;
        });
        return { ...group, hooks: filtered };
      })
      .filter((group) => (group.hooks ?? []).length > 0);
    if (kept.length > 0) hooks[event] = kept;
  }

  if (changed) {
    const next: Settings = { ...settings };
    if (Object.keys(hooks).length > 0) next.hooks = hooks;
    else delete next.hooks;
    writeSettings(settingsPath, next);
  }
  return { changed, settingsPath };
}

function settingsFile(projectDir: string): string {
  return path.join(projectDir, '.claude', 'settings.json');
}

function readSettings(settingsPath: string): Settings {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings is not an object');
    }
    return parsed as Settings;
  } catch (err) {
    // Never overwrite a file we can't faithfully reproduce.
    throw new Error(
      `${settingsPath} exists but is not valid JSON (${(err as Error).message}); fix it manually before running init`,
    );
  }
}

function writeSettings(settingsPath: string, value: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, settingsPath);
}
