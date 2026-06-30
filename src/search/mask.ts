import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import { MAX_ENEMIES, MAX_HAND } from './encode.js';

// Upper bounds for the flat action space. Sized with headroom over observed maxima:
//   branch    — map nodes have <=2 successors (map.ts)
//   hand      — MAX_HAND (shared with encode.ts so input positions align with slots)
//   targets   — MAX_ENEMIES enemy targets + 1 self/untargeted slot
//   reward    — reward screens offer <=3 cards
//   shop      — shop stock is small
//   eventOpt  — narrative events have <=3 options (content/events.ts)
export const MAX_BRANCH = 3;
export { MAX_HAND };
export const MAX_TARGETS = MAX_ENEMIES + 1;
export const MAX_REWARD = 4;
export const MAX_SHOP = 8;
export const MAX_EVENT_OPT = 4;
// M38 mechanics:
//   potions   — in-combat consumables; same target shape as playCard (enemy index or self).
//               DEFAULT_MAX_POTIONS=3; +1 headroom for config overrides.
//   buyPotion — shop potion stock (separate from card stock); small.
//   upgrade   — rest-screen upgradeCard by deckIndex; sized to a typical mid-run deck.
//               Overflow (deeper deck indices) drops to MCTS-only, not net-visible.
//   remove    — shop removeCard (deck-thinning service) by deckIndex; sized like upgrade.
//   continue  — single continueEvent slot (advances an event past its result screen).
export const MAX_POTIONS = 4;
export const MAX_SHOP_POTION = 4;
export const MAX_UPGRADE = 24;
export const MAX_REMOVE = 24;

const OFF_ENDTURN = 0;
const OFF_SKIP = 1;
const OFF_LEAVE = 2;
const OFF_REST = 3;
const OFF_NODE = 4;
const OFF_PLAY = OFF_NODE + MAX_BRANCH;
const OFF_REWARD = OFF_PLAY + MAX_HAND * MAX_TARGETS;
const OFF_SHOP = OFF_REWARD + MAX_REWARD;
const OFF_EVENT = OFF_SHOP + MAX_SHOP;
const OFF_USEPOTION = OFF_EVENT + MAX_EVENT_OPT;
const OFF_BUYPOTION = OFF_USEPOTION + MAX_POTIONS * MAX_TARGETS;
const OFF_UPGRADE = OFF_BUYPOTION + MAX_SHOP_POTION;
const OFF_REMOVE = OFF_UPGRADE + MAX_UPGRADE;
const OFF_CONTINUE = OFF_REMOVE + MAX_REMOVE;

/** Total width of the flat policy head. */
export const ACTION_SPACE = OFF_CONTINUE + 1;

/**
 * Flat slot index for an action, given the state it was generated from.
 * Returns null when the action cannot be represented (overflow) — the caller
 * records it as dropped rather than colliding it onto an occupied slot.
 */
export function slotOf(state: RunState, action: GameAction): number | null {
  switch (action.type) {
    case 'endTurn':
      return OFF_ENDTURN;
    case 'skipReward':
      return OFF_SKIP;
    case 'leaveShop':
      return OFF_LEAVE;
    case 'rest':
      return OFF_REST;
    case 'chooseNode': {
      const next = state.map.nodes[state.currentNodeId]?.next ?? [];
      const p = next.indexOf(action.nodeId);
      return p >= 0 && p < MAX_BRANCH ? OFF_NODE + p : null;
    }
    case 'playCard': {
      if (action.handIndex >= MAX_HAND) return null;
      const t = action.targetIndex ?? MAX_ENEMIES;
      if (t >= MAX_TARGETS) return null;
      return OFF_PLAY + action.handIndex * MAX_TARGETS + t;
    }
    case 'pickRewardCard':
      return action.index < MAX_REWARD ? OFF_REWARD + action.index : null;
    case 'buyCard':
      return action.index < MAX_SHOP ? OFF_SHOP + action.index : null;
    case 'chooseEventOption':
      return action.index < MAX_EVENT_OPT ? OFF_EVENT + action.index : null;
    case 'usePotion': {
      if (action.potionIndex >= MAX_POTIONS) return null;
      const t = action.targetIndex ?? MAX_ENEMIES; // self/all-enemies -> the untargeted slot
      if (t >= MAX_TARGETS) return null;
      return OFF_USEPOTION + action.potionIndex * MAX_TARGETS + t;
    }
    case 'buyPotion':
      return action.index < MAX_SHOP_POTION ? OFF_BUYPOTION + action.index : null;
    case 'upgradeCard':
      return action.deckIndex < MAX_UPGRADE ? OFF_UPGRADE + action.deckIndex : null;
    case 'removeCard':
      return action.deckIndex < MAX_REMOVE ? OFF_REMOVE + action.deckIndex : null;
    case 'continueEvent':
      return OFF_CONTINUE;
    default:
      // Unknown/overflowing action -> dropped (searchable via legalActions, invisible to the net)
      // rather than corrupting the mask with an undefined index.
      return null;
  }
}

export interface MaskedActions {
  /** 1 = legal, 0 = illegal. Length ACTION_SPACE. Multiply onto logits before softmax. */
  readonly mask: Float32Array;
  /** actions[slot] = the GameAction occupying that slot (null if empty). Decodes a net argmax. */
  readonly actions: (GameAction | null)[];
  /** Legal actions that overflowed the flat space — available to MCTS, invisible to the net. */
  readonly dropped: GameAction[];
}

/** Build the legal-action mask and slot->action decode table for a state. */
export function actionMask(content: ContentRegistry, state: RunState): MaskedActions {
  const mask = new Float32Array(ACTION_SPACE);
  const actions: (GameAction | null)[] = new Array(ACTION_SPACE).fill(null);
  const dropped: GameAction[] = [];
  for (const a of legalActions(content, state)) {
    const slot = slotOf(state, a);
    if (slot === null) {
      dropped.push(a);
      continue;
    }
    mask[slot] = 1;
    actions[slot] = a;
  }
  return { mask, actions, dropped };
}
