// Net-guided determinized search — the engine for AlphaZero self-play. Combines
// ISMCTS determinization (re-seed the hidden future each iteration → decision is a
// function of OBSERVABLE state → visit-distribution targets are LEARNABLE) with
// PUCT selection driven by the net's priors + value at leaves. As the net improves,
// the search improves, producing stronger learnable targets — the self-play flywheel.
import { applyAction } from '../engine/run.js';
import { initStreams } from '../engine/rng.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, slotOf } from './mask.js';
import { type NetParams, forward, policyPriors } from './net.js';

export interface AzSearchOptions {
  readonly iterations: number;
  readonly rand: () => number;
  readonly net: NetParams;
  readonly encoder: Encoder;
  readonly cPuct?: number;
}

export interface AzResult {
  readonly action: GameAction;
  readonly visits: Float32Array;
  readonly rootValue: number;
}

interface Node {
  readonly children: Map<number, Node>;
  readonly n: Map<number, number>;
  readonly w: Map<number, number>;
  readonly avail: Map<number, number>;
  priors: Float32Array | null; // set on first (leaf) evaluation
}

function newNode(): Node {
  return { children: new Map(), n: new Map(), w: new Map(), avail: new Map(), priors: null };
}

function isTerminal(s: RunState): boolean {
  return s.phase === 'victory' || s.phase === 'defeat';
}

function reseed(state: RunState, rand: () => number): RunState {
  return { ...state, rng: initStreams(`az-${Math.floor(rand() * 1e9)}`) };
}

function legalSlots(content: ContentRegistry, state: RunState): Array<{ slot: number; action: GameAction }> {
  const out: Array<{ slot: number; action: GameAction }> = [];
  for (const a of legalActions(content, state)) {
    const slot = slotOf(state, a);
    if (slot !== null) out.push({ slot, action: a });
  }
  return out;
}

export function azSearch(content: ContentRegistry, state: RunState, opts: AzSearchOptions): AzResult {
  const root = newNode();
  const c = opts.cPuct ?? 1.5;

  for (let iter = 0; iter < opts.iterations; iter++) {
    let det = reseed(state, opts.rand);
    let node = root;
    const path: Array<{ node: Node; slot: number }> = [];
    let value = 0;

    for (;;) {
      if (isTerminal(det)) {
        value = det.phase === 'victory' ? 1 : 0;
        break;
      }
      const ls = legalSlots(content, det);
      if (ls.length === 0) break;
      for (const { slot } of ls) node.avail.set(slot, (node.avail.get(slot) ?? 0) + 1);

      if (node.priors === null) {
        // Leaf: evaluate the net here (priors for children + value to back up).
        const out = forward(opts.net, opts.encoder.encode(det));
        const mask = new Float32Array(ACTION_SPACE);
        for (const { slot } of ls) mask[slot] = 1;
        node.priors = policyPriors(out.policy, mask);
        value = out.value;
        break;
      }

      // PUCT selection over the legal (available) actions.
      let sumN = 0;
      for (const { slot } of ls) sumN += node.n.get(slot) ?? 0;
      const sq = Math.sqrt(sumN) + 1e-8;
      let best = ls[0] as { slot: number; action: GameAction };
      let bestScore = -Infinity;
      for (const x of ls) {
        const n = node.n.get(x.slot) ?? 0;
        const w = node.w.get(x.slot) ?? 0;
        const q = n > 0 ? w / n : 0;
        const p = node.priors[x.slot] ?? 0;
        const u = c * p * (sq / (1 + n));
        const score = q + u + opts.rand() * 1e-9;
        if (score > bestScore) {
          bestScore = score;
          best = x;
        }
      }
      path.push({ node, slot: best.slot });
      if (!node.children.has(best.slot)) node.children.set(best.slot, newNode());
      det = applyAction(content, det, best.action);
      node = node.children.get(best.slot) as Node;
    }

    for (const step of path) {
      step.node.n.set(step.slot, (step.node.n.get(step.slot) ?? 0) + 1);
      step.node.w.set(step.slot, (step.node.w.get(step.slot) ?? 0) + value);
    }
  }

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
