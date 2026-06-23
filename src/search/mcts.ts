import { applyAction } from '../engine/run.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';

export type RolloutPolicy = (
  content: ContentRegistry,
  state: RunState,
  rand: () => number,
) => GameAction;

export interface MctsOptions {
  readonly iterations: number;
  readonly rollout: RolloutPolicy;
  readonly rand: () => number;
  readonly explore?: number;
  readonly maxRolloutSteps?: number;
}

function isTerminal(state: RunState): boolean {
  return state.phase === 'victory' || state.phase === 'defeat';
}

/** Value of a state in [0,1]: victory=1; otherwise progress-weighted, always < a win. */
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

function rollout(content: ContentRegistry, start: RunState, opts: MctsOptions): number {
  let state = start;
  const cap = opts.maxRolloutSteps ?? 4000;
  for (let steps = 0; steps < cap && !isTerminal(state); steps++) {
    let action: GameAction;
    try {
      action = opts.rollout(content, state, opts.rand);
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

/** Run UCT from `state` and return the best action. */
export function mctsAction(
  content: ContentRegistry,
  state: RunState,
  opts: MctsOptions,
): GameAction {
  const root = makeNode(content, state, null, null);
  if (root.untried.length <= 1) {
    return root.untried[0] ?? { type: 'endTurn' };
  }
  const c = opts.explore ?? Math.SQRT2;

  for (let iter = 0; iter < opts.iterations; iter++) {
    let node = root;
    // Select
    while (node.untried.length === 0 && node.children.length > 0 && !node.terminal) {
      node = bestChild(node, c, opts.rand);
    }
    // Expand
    if (!node.terminal && node.untried.length > 0) {
      const idx = Math.floor(opts.rand() * node.untried.length);
      const action = node.untried.splice(idx, 1)[0] as GameAction;
      const child = makeNode(content, applyAction(content, node.state, action), node, action);
      node.children.push(child);
      node = child;
    }
    // Simulate + backprop
    const v = node.terminal ? value(node.state) : rollout(content, node.state, opts);
    for (let n: Node | null = node; n !== null; n = n.parent) {
      n.visits++;
      n.total += v;
    }
  }

  let best = root.children[0];
  for (const child of root.children) {
    if (!best || child.visits > best.visits) best = child;
  }
  return best?.action ?? (root.untried[0] as GameAction) ?? { type: 'endTurn' };
}
