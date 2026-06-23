import { applyAction } from '../engine/run.js';
import { initStreams } from '../engine/rng.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { greedyRollout } from './heuristic.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import type { RolloutPolicy } from './mcts.js';

/** Replace the hidden RNG streams with a fresh seed — re-rolls all FUTURE randomness. */
export function reseed(state: RunState, rand: () => number): RunState {
  return { ...state, rng: initStreams(`det-${Math.floor(rand() * 1e9)}`) };
}

function rolloutToEnd(
  content: ContentRegistry,
  start: RunState,
  rollout: RolloutPolicy,
  rand: () => number,
): number {
  let s = start;
  for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
    let a: GameAction;
    try {
      a = rollout(content, s, rand);
    } catch {
      break;
    }
    try {
      s = applyAction(content, s, a);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      const legal = legalActions(content, s);
      if (legal.length === 0) break;
      s = applyAction(content, s, legal[0] as GameAction);
    }
  }
  return s.phase === 'victory' ? 1 : 0;
}

/** Expected win probability of taking `action` in `state`, over K re-seeded futures. */
export function qDeterminized(
  content: ContentRegistry,
  state: RunState,
  action: GameAction,
  k: number,
  rand: () => number,
  rollout: RolloutPolicy = greedyRollout,
): number {
  let wins = 0;
  for (let i = 0; i < k; i++) {
    const s = applyAction(content, reseed(state, rand), action);
    wins += rolloutToEnd(content, s, rollout, rand);
  }
  return wins / Math.max(1, k);
}

export interface QTargets {
  readonly mask: Float32Array;
  /** softmax(Q/tau) over legal actions — favors higher expected-win actions. */
  readonly pi: Float32Array;
  /** max_a Q — best achievable expected win probability from this state. */
  readonly value: number;
  /** Raw determinized Q per slot (for inspection). */
  readonly q: Float32Array;
}

/** Determinized Q for every legal action → learnable policy + value targets. */
export function buildQTargets(
  content: ContentRegistry,
  state: RunState,
  k: number,
  rand: () => number,
  tau = 0.3,
  rollout: RolloutPolicy = greedyRollout,
): QTargets {
  const { mask, actions } = actionMask(content, state);
  const q = new Float32Array(ACTION_SPACE);
  let maxQ = 0;
  for (let slot = 0; slot < ACTION_SPACE; slot++) {
    const a = actions[slot];
    if (!a) continue;
    const qa = qDeterminized(content, state, a, k, rand, rollout);
    q[slot] = qa;
    if (qa > maxQ) maxQ = qa;
  }
  const pi = new Float32Array(ACTION_SPACE);
  let mx = -Infinity;
  for (let slot = 0; slot < ACTION_SPACE; slot++)
    if ((mask[slot] ?? 0) > 0 && (q[slot] ?? 0) > mx) mx = q[slot] ?? 0;
  if (mx > -Infinity) {
    let sum = 0;
    for (let slot = 0; slot < ACTION_SPACE; slot++)
      if ((mask[slot] ?? 0) > 0) {
        const e = Math.exp(((q[slot] ?? 0) - mx) / tau);
        pi[slot] = e;
        sum += e;
      }
    if (sum > 0) for (let slot = 0; slot < ACTION_SPACE; slot++) pi[slot] = (pi[slot] ?? 0) / sum;
  }
  return { mask, pi, value: maxQ, q };
}
