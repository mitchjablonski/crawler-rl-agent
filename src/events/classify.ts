import type { GameEvent, GameEventKind, HookRecord } from './types.js';

// Linters / formatter-checks. Checked BEFORE build/test so "npm run lint" and
// the like aren't misread, and scoped tightly so they don't swallow real
// test/build commands (e.g. plain "cargo build" / "go test" never match here).
const LINT_PATTERNS: readonly RegExp[] = [
  /\beslint\b/,
  /\bbiome\b/,
  /\bruff\b/,
  /\bflake8\b/,
  /\bpylint\b/,
  /\bcargo clippy\b/,
  /\bclippy-driver\b/,
  /\brubocop\b/,
  /\bgolangci-lint\b/,
  /\bprettier\b[^&;|]*--check\b/,
  /\b(npm|yarn|pnpm|bun)(?: run)? lint\b/,
];

const TEST_PATTERNS: readonly RegExp[] = [
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bgo test\b/,
  /\bcargo test\b/,
  /\b(npm|yarn|pnpm|bun)(?: run)? test\b/,
];

const BUILD_PATTERNS: readonly RegExp[] = [
  /\btsc\b/,
  /\b(npm|yarn|pnpm|bun) run build\b/,
  /\bcargo build\b/,
  /\bgo build\b/,
  /(?:^|&&|;)\s*make\b/,
];

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXPLORE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);

/** Map a raw hook record to a semantic game event. Total: never throws, never null. */
export function classify(record: HookRecord): GameEvent {
  const at = typeof record.receivedAt === 'string' ? record.receivedAt : '';
  const payload = record.payload ?? {};
  const toolName = asString(payload['tool_name']) ?? '';

  switch (record.hookType) {
    case 'SessionStart':
      return ev('session_started', at);
    case 'Stop':
      return ev('claude_awaits_user', at);
    case 'Notification':
      return ev('attention_required', at, asString(payload['message']));
    case 'PreToolUse':
      if (toolName.startsWith('mcp__deeppairing__present_')) {
        return ev('review_requested', at, toolName.replace('mcp__deeppairing__', ''));
      }
      if (AGENT_TOOLS.has(toolName)) return ev('agent_spawned', at);
      return ev('activity', at, toolName || undefined);
    case 'PostToolUse':
      return classifyPostToolUse(at, toolName, payload);
    default:
      return ev('activity', at);
  }
}

function classifyPostToolUse(
  at: string,
  toolName: string,
  payload: Readonly<Record<string, unknown>>,
): GameEvent {
  const input = asRecord(payload['tool_input']);

  if (EDIT_TOOLS.has(toolName)) {
    return ev('code_changed', at, baseName(asString(input['file_path'])));
  }
  if (EXPLORE_TOOLS.has(toolName)) {
    const detail =
      baseName(asString(input['file_path'])) ??
      asString(input['pattern']) ??
      asString(input['query']);
    return ev('file_explored', at, detail);
  }
  if (toolName === 'Bash') {
    const command = asString(input['command']) ?? '';
    const verdict = commandVerdict(payload);
    // Order matters: lint before build/test so "npm run lint" isn't misread,
    // and commit is checked independently of exit-code verdicts.
    if (LINT_PATTERNS.some((p) => p.test(command))) {
      if (verdict === null) return ev('activity', at, truncate(command));
      return ev(verdict ? 'lint_passed' : 'lint_failed', at, truncate(command));
    }
    // Push before commit: a "git push" is its own celebratory beat and must not
    // be read as a commit (nor vice-versa). Both are verdict-independent.
    if (/\bgit\s+push\b/.test(command)) {
      return ev('pushed', at, truncate(command));
    }
    if (/\bgit\s+commit\b/.test(command)) {
      return ev('committed', at, truncate(command));
    }
    if (TEST_PATTERNS.some((p) => p.test(command))) {
      if (verdict === null) return ev('activity', at, truncate(command));
      return ev(verdict ? 'tests_passed' : 'tests_failed', at, truncate(command));
    }
    if (BUILD_PATTERNS.some((p) => p.test(command))) {
      if (verdict === null) return ev('activity', at, truncate(command));
      return ev(verdict ? 'build_passed' : 'build_failed', at, truncate(command));
    }
    return ev('activity', at, truncate(command));
  }
  return ev('activity', at, toolName || undefined);
}

/** true = success, false = failure, null = indeterminate. */
function commandVerdict(payload: Readonly<Record<string, unknown>>): boolean | null {
  const response = asRecord(payload['tool_response']);
  const exitCode = response['exitCode'] ?? response['exit_code'] ?? response['code'];
  if (typeof exitCode === 'number') return exitCode === 0;
  const success = response['success'];
  if (typeof success === 'boolean') return success;
  return null;
}

function ev(kind: GameEventKind, at: string, detail?: string): GameEvent {
  return detail === undefined ? { kind, at } : { kind, at, detail };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function baseName(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || undefined;
}

function truncate(text: string, max = 48): string | undefined {
  if (text.length === 0) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
