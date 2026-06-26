import { describe, expect, it } from 'vitest';
import { classify } from './classify.js';
import type { HookRecord } from './types.js';

const rec = (
  hookType: string,
  payload: Record<string, unknown> = {},
): HookRecord => ({ hookType, receivedAt: '2026-06-10T12:00:00Z', payload });

const bash = (command: string, response: Record<string, unknown> = {}) =>
  rec('PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: response,
  });

describe('classify', () => {
  it('maps lifecycle hooks', () => {
    expect(classify(rec('SessionStart')).kind).toBe('session_started');
    expect(classify(rec('Stop')).kind).toBe('claude_awaits_user');
    const note = classify(rec('Notification', { message: 'needs permission' }));
    expect(note.kind).toBe('attention_required');
    expect(note.detail).toBe('needs permission');
  });

  it('maps edit and exploration tools', () => {
    const edit = classify(
      rec('PostToolUse', {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/src/engine/run.ts' },
      }),
    );
    expect(edit.kind).toBe('code_changed');
    expect(edit.detail).toBe('run.ts');

    const read = classify(
      rec('PostToolUse', { tool_name: 'Grep', tool_input: { pattern: 'applyAction' } }),
    );
    expect(read.kind).toBe('file_explored');
    expect(read.detail).toBe('applyAction');
  });

  it('detects test and build outcomes from command + exit info', () => {
    expect(classify(bash('npm test', { exitCode: 0 })).kind).toBe('tests_passed');
    expect(classify(bash('npx vitest run', { exitCode: 1 })).kind).toBe('tests_failed');
    expect(classify(bash('cargo test', { success: true })).kind).toBe('tests_passed');
    expect(classify(bash('npm run build', { exitCode: 2 })).kind).toBe('build_failed');
    expect(classify(bash('tsc -p tsconfig.json', { exit_code: 0 })).kind).toBe('build_passed');
  });

  it('degrades indeterminate test/build runs to activity instead of guessing', () => {
    expect(classify(bash('npm test')).kind).toBe('activity');
    expect(classify(bash('npm run build', { stdout: 'done' })).kind).toBe('activity');
  });

  it('detects lint outcomes from command + exit info', () => {
    expect(classify(bash('npm run lint', { exitCode: 0 })).kind).toBe('lint_passed');
    expect(classify(bash('npx eslint .', { exitCode: 1 })).kind).toBe('lint_failed');
    expect(classify(bash('cargo clippy', { success: true })).kind).toBe('lint_passed');
    expect(classify(bash('ruff check src', { exitCode: 2 })).kind).toBe('lint_failed');
    expect(classify(bash('prettier --check .', { exitCode: 0 })).kind).toBe('lint_passed');
    // Indeterminate lint degrades to activity, like tests/build.
    expect(classify(bash('npm run lint')).kind).toBe('activity');
  });

  it('does not confuse lint with test/build (and vice-versa)', () => {
    // Lint commands must NOT be read as test/build...
    expect(classify(bash('npm run lint', { exitCode: 0 })).kind).toBe('lint_passed');
    // ...and real test/build commands must NOT be read as lint.
    expect(classify(bash('npm test', { exitCode: 0 })).kind).toBe('tests_passed');
    expect(classify(bash('npm run build', { exitCode: 0 })).kind).toBe('build_passed');
    expect(classify(bash('cargo test', { exitCode: 0 })).kind).toBe('tests_passed');
    expect(classify(bash('cargo build', { exitCode: 0 })).kind).toBe('build_passed');
  });

  it('detects git commits regardless of verdict', () => {
    expect(classify(bash('git commit -m "wip"', { exitCode: 0 })).kind).toBe('committed');
    expect(classify(bash('git commit --amend')).kind).toBe('committed');
    // A commit is never a push.
    expect(classify(bash('git commit -m "wip"', { exitCode: 0 })).kind).not.toBe('pushed');
  });

  it('detects git push regardless of verdict, distinct from commit', () => {
    expect(classify(bash('git push', { exitCode: 0 })).kind).toBe('pushed');
    expect(classify(bash('git push origin main', { exitCode: 0 })).kind).toBe('pushed');
    expect(classify(bash('git push')).kind).toBe('pushed');
    // A push is its own beat: never a commit, never plain activity.
    const pushed = classify(bash('git push origin main', { exitCode: 0 })).kind;
    expect(pushed).not.toBe('committed');
    expect(pushed).not.toBe('activity');
    // A non-git command is unaffected by the push branch.
    expect(classify(bash('echo pushing the limits', { exitCode: 0 })).kind).toBe('activity');
  });

  it('spawns agents and pings deepPairing reviews', () => {
    expect(classify(rec('PreToolUse', { tool_name: 'Task' })).kind).toBe('agent_spawned');
    const review = classify(
      rec('PreToolUse', { tool_name: 'mcp__deeppairing__present_options' }),
    );
    expect(review.kind).toBe('review_requested');
    expect(review.detail).toBe('present_options');
    // Non-presenting deepPairing tools are not review pings.
    expect(classify(rec('PreToolUse', { tool_name: 'mcp__deeppairing__check_feedback' })).kind).toBe(
      'activity',
    );
  });

  it('is total: junk shapes become activity, never throws', () => {
    expect(classify(rec('SomethingNew')).kind).toBe('activity');
    expect(classify(rec('PostToolUse')).kind).toBe('activity');
    expect(
      classify({
        hookType: 'PostToolUse',
        receivedAt: '',
        payload: { tool_name: 42, tool_input: 'nope', tool_response: null } as never,
      }).kind,
    ).toBe('activity');
  });
});
