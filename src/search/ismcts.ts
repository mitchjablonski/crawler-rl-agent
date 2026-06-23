// Information Set MCTS (determinized UCT). Each iteration re-seeds the hidden RNG
// (a fresh "determinization" of the future) and descends a shared tree keyed by
// action SLOTS, with availability-aware UCB. Because the decision averages over
// determinizations, it depends only on the OBSERVABLE state — strong (search-guided)
// AND a learnable target, unlike clairvoyant MCTS. Used as the hard-difficulty expert.
import { applyAction } from '../engine/run.js';
import { initStreams } from '../engine/rng.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { greedyRollout } from './heuristic.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, slotOf } from './mask.js';
import type { RolloutPolicy } from './mcts.js';

export interface IsmctsOptions {
  readonly iterations: number;
  readonly rand: () => number;
  readonly rollout?: RolloutPolicy;
  readonly explore?: number;
  readonly rolloutCap?: number;
}

export interface IsmctsResult {
  readonly action: GameAction;
  readonly visits: Float32Array;
  readonly rootValue: number;
}

interface ISNode {
  readonly children: Map<number, ISNode>;
  readonly n: Map<number, number>; // selections per action slot
  readonly w: Map<number, number>; // value sum per action slot
  readonly avail: Map<number, number>; // iterations the slot was legal here
}

function newNode(): ISNode {
  return { children: new Map(), n: new Map(), w: new Map(), avail: new Map() };
}

function isTerminal(s: RunState): boolean {
  return s.phase === 'victory' || s.phase === 'defeat';
}

function reseed(state: RunState, rand: () => number): RunState {
  return { ...state, rng: initStreams(`is-${Math.floor(rand() * 1e9)}`) };
}

function legalSlots(content: ContentRegistry, state: RunState): Array<{ slot: number; action: GameAction }> {
  const out: Array<{ slot: number; action: GameAction }> = [];
  for (const a of legalActions(content, state)) {
    const slot = slotOf(state, a);
    if (slot !== null) out.push({ slot, action: a });
  }
  return out;
}

function rolloutTo(
  content: ContentRegistry,
  start: RunState,
  policy: RolloutPolicy,
  rand: () => number,
  cap: number,
): number {
  let s = start;
  for (let i = 0; i < cap && !isTerminal(s); i++) {
    let a: GameAction;
    try {
      a = policy(content, s, rand);
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

export function ismctsSearch(
  content: ContentRegistry,
  state: RunState,
  opts: IsmctsOptions,
): IsmctsResult {
  const root = newNode();
  const c = opts.explore ?? Math.SQRT2;
  const policy = opts.rollout ?? greedyRollout;
  const cap = opts.rolloutCap ?? 4000;

  for (let iter = 0; iter < opts.iterations; iter++) {
    let det = reseed(state, opts.rand); // a fresh determinization of the hidden future
    let node = root;
    const path: Array<{ node: ISNode; slot: number }> = [];

    // Selection + single expansion, replaying actions on the determinized state.
    for (;;) {
      if (isTerminal(det)) break;
      const ls = legalSlots(content, det);
      if (ls.length === 0) break;
      for (const { slot } of ls) node.avail.set(slot, (node.avail.get(slot) ?? 0) + 1);

      const untried = ls.filter((x) => !node.children.has(x.slot));
      if (untried.length > 0) {
        const pick = untried[Math.floor(opts.rand() * untried.length)] as { slot: number; action: GameAction };
        node.children.set(pick.slot, newNode());
        node.n.set(pick.slot, 0);
        node.w.set(pick.slot, 0);
        path.push({ node, slot: pick.slot });
        det = applyAction(content, det, pick.action);
        node = node.children.get(pick.slot) as ISNode;
        break;
      }

      // UCB1 over the legal (available) actions.
      let best = ls[0] as { slot: number; action: GameAction };
      let bestScore = -Infinity;
      for (const x of ls) {
        const n = node.n.get(x.slot) ?? 0;
        const w = node.w.get(x.slot) ?? 0;
        const av = node.avail.get(x.slot) ?? 1;
        const q = n > 0 ? w / n : 0;
        const u = c * Math.sqrt(Math.log(av + 1) / (n + 1));
        const score = q + u + opts.rand() * 1e-9;
        if (score > bestScore) {
          bestScore = score;
          best = x;
        }
      }
      path.push({ node, slot: best.slot });
      det = applyAction(content, det, best.action);
      node = node.children.get(best.slot) as ISNode;
    }

    const v = isTerminal(det) ? (det.phase === 'victory' ? 1 : 0) : rolloutTo(content, det, policy, opts.rand, cap);
    for (const step of path) {
      step.node.n.set(step.slot, (step.node.n.get(step.slot) ?? 0) + 1);
      step.node.w.set(step.slot, (step.node.w.get(step.slot) ?? 0) + v);
    }
  }

  // Root legal set is fixed (reseed doesn't change the materialized state).
  const slotToAction = new Map(legalSlots(content, state).map((x) => [x.slot, x.action] as const));
  const visits = new Float32Array(ACTION_SPACE);
  let bestSlot = -1;
  let bestN = -1;
  let totalN = 0;
  let totalW = 0;
  for (const [slot, n] of root.n) {
    visits[slot] = n;
    totalN += n;
    totalW += root.w.get(slot) ?? 0;
    if (n > bestN) {
      bestN = n;
      bestSlot = slot;
    }
  }
  const action =
    (bestSlot >= 0 ? slotToAction.get(bestSlot) : undefined) ??
    legalSlots(content, state)[0]?.action ?? { type: 'endTurn' };
  return { action, visits, rootValue: totalN > 0 ? totalW / totalN : 0 };
}
