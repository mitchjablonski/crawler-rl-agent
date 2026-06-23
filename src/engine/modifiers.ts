import { withStream } from './rng.js';
import type { ContentRegistry, RunState, StatusId } from './types.js';
import { isSafeBoundary } from './types.js';

/**
 * The closed set of effects external events may trigger (REQ-5). Everything
 * here selects among pre-balanced outcomes; bounds are engine constants.
 */
export type Modifier =
  | { kind: 'lootRoll'; size: 'small' | 'big' }
  | { kind: 'healPlayer'; amount: number }
  | { kind: 'queueElite'; enemyId: string }
  | { kind: 'blessNextCombat'; status: StatusId; stacks: number };

export const MAX_QUEUED_ELITES = 2;
export const MAX_BLESS_STACKS = 3;
export const MAX_HEAL = 10;

const LOOT_RANGES: Readonly<Record<'small' | 'big', readonly [number, number]>> = {
  small: [3, 8],
  big: [15, 25],
};

/**
 * Apply one bounded modifier. Only meaningful at safe boundaries; callers
 * queue until then, and this is additionally a no-op elsewhere (defense in
 * depth — events are untrusted input).
 */
export function applyModifier(
  content: ContentRegistry,
  state: RunState,
  modifier: Modifier,
): RunState {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  if (!isSafeBoundary(state)) return state;

  switch (modifier.kind) {
    case 'lootRoll': {
      const [min, max] = LOOT_RANGES[modifier.size];
      const [gold, rng] = withStream(state.rng, 'modifiers', (r) => r.intBetween(min, max));
      return { ...state, rng, gold: state.gold + gold };
    }
    case 'healPlayer': {
      const amount = Math.max(0, Math.min(MAX_HEAL, modifier.amount));
      return { ...state, hp: Math.min(state.maxHp, state.hp + amount) };
    }
    case 'queueElite': {
      if (!content.enemies[modifier.enemyId]) return state;
      const queued = state.modifiers.queuedEliteIds;
      if (queued.length >= MAX_QUEUED_ELITES) return state;
      return {
        ...state,
        modifiers: { ...state.modifiers, queuedEliteIds: [...queued, modifier.enemyId] },
      };
    }
    case 'blessNextCombat': {
      const current = state.modifiers.nextCombatStatuses[modifier.status] ?? 0;
      const next = Math.min(MAX_BLESS_STACKS, current + Math.max(0, modifier.stacks));
      return {
        ...state,
        modifiers: {
          ...state.modifiers,
          nextCombatStatuses: {
            ...state.modifiers.nextCombatStatuses,
            [modifier.status]: next,
          },
        },
      };
    }
  }
}
