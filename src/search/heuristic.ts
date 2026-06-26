// Greedy game heuristic, lifted from scripts/playtest.ts so it is importable as a
// library (refresh-safe; not an edit to upstream). Used as the MCTS rollout policy
// for the expert — MCTS + this greedy rollout reaches 100% win rate at base.
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import type { RolloutPolicy } from './mcts.js';

function livingTarget(state: RunState, lowest: boolean): number | undefined {
  const enemies = state.combat?.enemies ?? [];
  let best = -1;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.hp <= 0) continue;
    if (best === -1) best = i;
    else {
      const cur = enemies[best] as { hp: number };
      if (lowest ? e.hp < cur.hp : e.hp > cur.hp) best = i;
    }
  }
  return best === -1 ? undefined : best;
}

function navAction(state: RunState, hpFrac: number, rand: () => number): GameAction {
  const next = state.map.nodes[state.currentNodeId]?.next ?? [];
  if (next.length === 0) throw new EngineError('dead-end map node');
  const scored = next.map((id) => {
    const kind = state.map.nodes[id]?.kind;
    let score = rand() * 0.1;
    if (kind === 'rest' && hpFrac < 0.6) score += 2;
    if (kind === 'elite') score += hpFrac > 0.7 ? 0.5 : -2;
    if (kind === 'shop') score += 0.2;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { type: 'chooseNode', nodeId: (scored[0] as { id: string }).id };
}

function combatAction(
  state: RunState,
  content: ContentRegistry,
  prefer: 'attack' | 'block',
): GameAction {
  const combat = state.combat;
  if (!combat) throw new EngineError('no combat');
  const order = prefer === 'block' ? ['power', 'skill', 'attack'] : ['power', 'attack', 'skill'];
  for (const type of order) {
    for (let i = 0; i < combat.hand.length; i++) {
      const card = content.cards[combat.hand[i] as string];
      if (!card || card.type !== type || card.cost > combat.energy) continue;
      return {
        type: 'playCard',
        handIndex: i,
        targetIndex: card.target === 'enemy' ? livingTarget(state, true) : undefined,
      };
    }
  }
  return { type: 'endTurn' };
}

function nonCombat(state: RunState, content: ContentRegistry, rand: () => number): GameAction {
  switch (state.phase) {
    case 'map':
      return navAction(state, state.hp / state.maxHp, rand);
    case 'reward':
      return state.reward?.cards.length
        ? { type: 'pickRewardCard', index: 0 }
        : { type: 'skipReward' };
    case 'shop': {
      const stock = state.shop?.stock ?? [];
      const i = stock.findIndex((s) => !s.sold && state.gold >= s.price + 20);
      return i >= 0 ? { type: 'buyCard', index: i } : { type: 'leaveShop' };
    }
    case 'rest':
      return { type: 'rest' };
    case 'event': {
      // M38 events can show a result screen (only continueEvent is legal) and gate
      // options behind requirements — take the first legal move instead of a fixed index.
      const legal = legalActions(content, state);
      return legal[0] ?? { type: 'continueEvent' };
    }
    default:
      throw new EngineError(`no non-combat action for phase ${state.phase}`);
  }
}

/** Greedy policy: in combat play the best affordable card (by type order), else navigate sensibly. */
export function greedyAction(
  state: RunState,
  content: ContentRegistry,
  rand: () => number,
  prefer: 'attack' | 'block' = 'attack',
): GameAction {
  if (state.phase === 'combat') return combatAction(state, content, prefer);
  return nonCombat(state, content, rand);
}

/** The greedy policy as an MCTS rollout. */
export const greedyRollout: RolloutPolicy = (content, state, rand) =>
  greedyAction(state, content, rand, 'attack');
