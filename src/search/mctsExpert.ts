import { applyAction } from '../engine/run.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { greedyRollout } from './heuristic.js';
import { legalActions } from './legalActions.js';
import { ACTION_SPACE, slotOf } from './mask.js';
import type { RolloutPolicy } from './mcts.js';

export interface MctsExpertSearchOptions {
  readonly iterations: number;
  readonly rand: () => number;
  readonly rollout?: RolloutPolicy;
  readonly explore?: number;
  readonly maxRolloutSteps?: number;
  /** If provided, every tree node's state is pushed here — the branches MCTS explored. */
  readonly collectStates?: RunState[];
}

export interface MctsExpertResult {
  /** Robust (most-visited) action. */
  readonly action: GameAction;
  /** Visit counts per flat action slot — the soft policy target. */
  readonly visits: Float32Array;
  /** Root mean value in [0,1] — a graded per-state value target. */
  readonly rootValue: number;
}

function isTerminal(state: RunState): boolean {
  return state.phase === 'victory' || state.phase === 'defeat';
}

/** Same potential as mcts.ts value(): victory=1, else progress-weighted, capped < a win. */
function value(state: RunState): number {
  if (state.phase === 'victory') return 1;
  const bossRow = state.map.nodes[state.map.bossId]?.row ?? 1;
  const depth = (state.map.nodes[state.currentNodeId]?.row ?? 0) / Math.max(1, bossRow);
  const hpFrac = state.maxHp > 0 ? state.hp / state.maxHp : 0;
  return Math.min(0.8, depth * 0.6 + hpFrac * 0.2);
}

interface Node {
  state: RunState;
  parent: Node | null;
  action: GameAction | null;
  children: Node[];
  untried: GameAction[];
  visits: number;
  total: number;
  terminal: boolean;
}

function makeNode(
  content: ContentRegistry,
  state: RunState,
  parent: Node | null,
  action: GameAction | null,
): Node {
  return {
    state,
    parent,
    action,
    children: [],
    untried: legalActions(content, state),
    visits: 0,
    total: 0,
    terminal: isTerminal(state),
  };
}

function simulate(
  content: ContentRegistry,
  start: RunState,
  rollout: RolloutPolicy,
  opts: MctsExpertSearchOptions,
): number {
  let state = start;
  const cap = opts.maxRolloutSteps ?? 4000;
  for (let steps = 0; steps < cap && !isTerminal(state); steps++) {
    let action: GameAction;
    try {
      action = rollout(content, state, opts.rand);
    } catch {
      break;
    }
    try {
      state = applyAction(content, state, action);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      const legal = legalActions(content, state);
      if (legal.length === 0) break;
      state = applyAction(content, state, legal[0] as GameAction);
    }
  }
  return value(state);
}

function bestChild(node: Node, c: number, rand: () => number): Node {
  let best = node.children[0] as Node;
  let bestScore = -Infinity;
  for (const child of node.children) {
    const exploit = child.total / child.visits;
    const explore = c * Math.sqrt(Math.log(node.visits) / child.visits);
    const score = exploit + explore + rand() * 1e-9;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }
  return best;
}

/** Run clairvoyant UCT and return the robust action, the visit distribution, and root value. */
export function mctsExpertSearch(
  content: ContentRegistry,
  state: RunState,
  opts: MctsExpertSearchOptions,
): MctsExpertResult {
  const root = makeNode(content, state, null, null);
  const c = opts.explore ?? Math.SQRT2;
  const rollout = opts.rollout ?? greedyRollout;
  opts.collectStates?.push(root.state);

  for (let iter = 0; iter < opts.iterations; iter++) {
    let node = root;
    while (node.untried.length === 0 && node.children.length > 0 && !node.terminal) {
      node = bestChild(node, c, opts.rand);
    }
    if (!node.terminal && node.untried.length > 0) {
      const idx = Math.floor(opts.rand() * node.untried.length);
      const action = node.untried.splice(idx, 1)[0] as GameAction;
      // A legal action can still be rejected by the engine; drop it (it's already removed from
      // untried) and continue this iteration rather than aborting the whole search.
      let next: RunState;
      try {
        next = applyAction(content, node.state, action);
      } catch (err) {
        if (!(err instanceof EngineError)) throw err;
        continue;
      }
      const child = makeNode(content, next, node, action);
      node.children.push(child);
      opts.collectStates?.push(child.state);
      node = child;
    }
    const v = node.terminal ? value(node.state) : simulate(content, node.state, rollout, opts);
    for (let n: Node | null = node; n !== null; n = n.parent) {
      n.visits++;
      n.total += v;
    }
  }

  const visits = new Float32Array(ACTION_SPACE);
  let best: Node | undefined;
  for (const child of root.children) {
    if (!child.action) continue;
    const slot = slotOf(state, child.action);
    if (slot === null) continue; // slot-less action can't be a training target — keep `action`
    visits[slot] = child.visits; //   consistent with the visit distribution by only ranking
    if (!best || child.visits > best.visits) best = child; //   representable children.
  }
  const action =
    best?.action ?? (legalActions(content, state)[0] as GameAction | undefined) ?? { type: 'endTurn' };
  const rootValue = root.visits > 0 ? root.total / root.visits : 0;
  return { action, visits, rootValue };
}
