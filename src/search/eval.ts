import { applyAction, createRun } from '../engine/run.js';
import type { ContentRegistry, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { slotOf } from './mask.js';
import type { NetParams } from './net.js';
import { policyAction } from './policy.js';
import { puctAction } from './puct.js';
import type { SelfPlayOptions } from './train.js';

export interface AgreementResult {
  /** Fraction of states where the student's no-search argmax == the teacher's PUCT action. */
  readonly agreement: number;
  /** Number of decision states compared. */
  readonly states: number;
}

/**
 * Imitation agreement: drive episodes along the TEACHER's PUCT trajectory and, at
 * each state, check whether the no-search student would pick the same action.
 * Per-state (low variance), unlike win rate which is per-episode.
 */
export function imitationAgreement(
  content: ContentRegistry,
  studentEncoder: Encoder,
  student: NetParams,
  teacher: SelfPlayOptions,
  seeds: readonly string[],
): AgreementResult {
  let match = 0;
  let total = 0;
  for (const seed of seeds) {
    let state: RunState = createRun(content, seed, teacher.config);
    for (let i = 0; i < 4000 && state.phase !== 'victory' && state.phase !== 'defeat'; i++) {
      const teacherMove = puctAction(content, state, {
        encoder: teacher.encoder,
        net: teacher.net,
        iterations: teacher.searchIterations,
        rand: teacher.rand,
      });
      const studentMove = policyAction(content, state, studentEncoder, student);
      total++;
      if (slotOf(state, teacherMove) === slotOf(state, studentMove)) match++;
      state = applyAction(content, state, teacherMove);
    }
  }
  return { agreement: total > 0 ? match / total : 0, states: total };
}
