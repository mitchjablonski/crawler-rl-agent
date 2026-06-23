/** One line of a session JSONL event file, as written by `ccc hook`. */
export interface HookRecord {
  readonly hookType: string;
  readonly receivedAt: string; // ISO timestamp
  readonly payload: Readonly<Record<string, unknown>>;
}

export type GameEventKind =
  | 'session_started'
  | 'tests_passed'
  | 'tests_failed'
  | 'build_passed'
  | 'build_failed'
  | 'code_changed'
  | 'file_explored'
  | 'agent_spawned'
  | 'claude_awaits_user'
  | 'attention_required'
  | 'review_requested'
  | 'activity';

export interface GameEvent {
  readonly kind: GameEventKind;
  readonly at: string;
  /** Short human-readable detail for narration (file name, command, message). */
  readonly detail?: string;
}
