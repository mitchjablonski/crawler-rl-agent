import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { type NetParams, forward, policyPriors } from './net.js';

/** Highest-probability legal action from one net forward pass — no search. */
export function policyAction(
  content: ContentRegistry,
  state: RunState,
  encoder: Encoder,
  net: NetParams,
): GameAction {
  const { mask, actions } = actionMask(content, state);
  const priors = policyPriors(forward(net, encoder.encode(state)).policy, mask);
  let bestSlot = -1;
  let best = -Infinity;
  for (let i = 0; i < ACTION_SPACE; i++) {
    if ((mask[i] ?? 0) > 0 && (priors[i] ?? 0) > best) {
      best = priors[i] ?? 0;
      bestSlot = i;
    }
  }
  return (
    (bestSlot >= 0 ? actions[bestSlot] : null) ??
    actions.find((a): a is GameAction => a !== null) ?? { type: 'endTurn' }
  );
}

/** No-search win rate over a set of (held-out) seeds. */
export function policyWinRate(
  content: ContentRegistry,
  encoder: Encoder,
  net: NetParams,
  config: RunConfig,
  seeds: readonly string[],
): number {
  if (seeds.length === 0) return 0;
  let wins = 0;
  for (const seed of seeds) {
    let state: RunState = createRun(content, seed, config);
    for (let i = 0; i < 4000 && state.phase !== 'victory' && state.phase !== 'defeat'; i++) {
      state = applyAction(content, state, policyAction(content, state, encoder, net));
    }
    if (state.phase === 'victory') wins++;
  }
  return wins / seeds.length;
}
