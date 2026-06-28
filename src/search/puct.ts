import { applyAction } from '../engine/run.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import type { RolloutPolicy } from './mcts.js';
import { type NetParams, forward, policyPriors } from './net.js';

export interface PuctOptions {
  readonly encoder: Encoder;
  readonly net: NetParams;
  readonly iterations: number;
  readonly rand: () => number;
  readonly cPuct?: number;
  readonly maxDepth?: number;
  /** Hybrid: if set, evaluate leaves by rolling this policy to terminal instead of the value head. */
  readonly leafRollout?: RolloutPolicy;
  /**
   * Fraction of the learned value head mixed into the rollout leaf value:
   * `v = (1−leafBlend)·rollout + leafBlend·valueHead`. Only applies when `leafRollout` is set.
   * 0 (default) = pure rollout (low bias, rollout-capped); 1 = pure value head (low variance,
   * lifts heavy-search/brutal regimes the greedy rollout caps). Ignored without leafRollout.
   */
  readonly leafBlend?: number;
  /**
   * Leaf value estimate to use instead of the policy net's value head (which is collapsed; see
   * docs/value-head-calibration.md). When set, this replaces `out.value` in the leaf blend — e.g. a
   * SEPARATE value network's prediction on its own threat-aware encoding. Leaves the policy net (and
   * its priors) untouched.
   */
  readonly leafValueFn?: (state: RunState) => number;
  /** Mix net priors toward uniform by this factor (0=pure net, 1=uniform≈pure MCTS). Guards bad priors. */
  readonly priorMix?: number;
}

/** Roll a policy to terminal from `start`; return 1 victory / 0 otherwise. */
function rolloutValue(
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

export interface PuctResult {
  readonly action: GameAction;
  /** Visit counts per flat action slot — the policy-improvement target π for training. */
  readonly visits: Float32Array;
}

interface PNode {
  readonly state: RunState;
  readonly terminal: boolean;
  readonly termValue: number;
  expanded: boolean;
  priors: Float32Array;
  mask: Float32Array;
  actions: (GameAction | null)[];
  readonly children: Map<number, PNode>;
  n: number;
  w: number;
}

function makeNode(state: RunState): PNode {
  const terminal = state.phase === 'victory' || state.phase === 'defeat';
  return {
    state,
    terminal,
    termValue: state.phase === 'victory' ? 1 : 0,
    expanded: false,
    priors: new Float32Array(0),
    mask: new Float32Array(0),
    actions: [],
    children: new Map(),
    n: 0,
    w: 0,
  };
}

function bestSlot(node: PNode, cPuct: number, rand: () => number): number {
  let best = -1;
  let bestScore = -Infinity;
  const sqrtN = Math.sqrt(node.n);
  for (let slot = 0; slot < ACTION_SPACE; slot++) {
    if ((node.mask[slot] ?? 0) === 0) continue;
    const child = node.children.get(slot);
    const childN = child ? child.n : 0;
    const q = child && child.n > 0 ? child.w / child.n : 0;
    const u = cPuct * (node.priors[slot] ?? 0) * (sqrtN / (1 + childN));
    const score = q + u + rand() * 1e-9;
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }
  }
  return best;
}

function simulate(
  content: ContentRegistry,
  node: PNode,
  opts: PuctOptions,
  depth: number,
): number {
  if (node.terminal) {
    node.n++;
    node.w += node.termValue;
    return node.termValue;
  }
  if (!node.expanded) {
    const { mask, actions } = actionMask(content, node.state);
    const out = forward(opts.net, opts.encoder.encode(node.state));
    node.priors = policyPriors(out.policy, mask);
    const mix = opts.priorMix ?? 0;
    if (mix > 0) {
      let legal = 0;
      for (let i = 0; i < ACTION_SPACE; i++) if ((mask[i] ?? 0) > 0) legal++;
      if (legal > 0) {
        const u = 1 / legal;
        for (let i = 0; i < ACTION_SPACE; i++)
          if ((mask[i] ?? 0) > 0) node.priors[i] = (1 - mix) * (node.priors[i] ?? 0) + mix * u;
      }
    }
    node.mask = mask;
    node.actions = actions;
    node.expanded = true;
    // Leaf value: a value estimate (the policy head, or a supplied separate value net), a greedy
    // rollout, or a blend of the two (leafBlend).
    const headV = opts.leafValueFn ? opts.leafValueFn(node.state) : out.value;
    let value: number;
    if (opts.leafRollout) {
      const rollout = rolloutValue(content, node.state, opts.leafRollout, opts.rand);
      const blend = opts.leafBlend ?? 0;
      value = blend > 0 ? (1 - blend) * rollout + blend * headV : rollout;
    } else {
      value = headV;
    }
    node.n++;
    node.w += value;
    return value;
  }
  const slot = bestSlot(node, opts.cPuct ?? 1.5, opts.rand);
  if (slot < 0 || depth >= (opts.maxDepth ?? 4000)) {
    node.n++;
    return node.n > 0 ? node.w / node.n : 0;
  }
  let child = node.children.get(slot);
  if (!child) {
    const action = node.actions[slot];
    if (!action) {
      node.n++;
      return node.n > 0 ? node.w / node.n : 0;
    }
    try {
      child = makeNode(applyAction(content, node.state, action));
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      node.mask[slot] = 0; // mask the offending slot and bail this descent
      node.n++;
      return node.n > 0 ? node.w / node.n : 0;
    }
    node.children.set(slot, child);
  }
  const v = simulate(content, child, opts, depth + 1);
  node.n++;
  node.w += v;
  return v;
}

/** Run net-guided PUCT from `state`; return the robust action and visit distribution. */
export function puctSearch(content: ContentRegistry, state: RunState, opts: PuctOptions): PuctResult {
  const root = makeNode(state);
  for (let i = 0; i < opts.iterations; i++) simulate(content, root, opts, 0);

  const visits = new Float32Array(ACTION_SPACE);
  let bestSlotIdx = -1;
  let bestVisits = -1;
  for (const [slot, child] of root.children) {
    visits[slot] = child.n;
    if (child.n > bestVisits) {
      bestVisits = child.n;
      bestSlotIdx = slot;
    }
  }
  const action =
    (bestSlotIdx >= 0 ? root.actions[bestSlotIdx] : null) ??
    root.actions.find((a): a is GameAction => a !== null) ??
    { type: 'endTurn' };
  return { action, visits };
}

export function puctAction(content: ContentRegistry, state: RunState, opts: PuctOptions): GameAction {
  return puctSearch(content, state, opts).action;
}
