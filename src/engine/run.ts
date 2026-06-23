import { generateMap } from './map.js';
import { initStreams, withStream, type Rng } from './rng.js';
import {
  applyRelics,
  endTurn,
  isCombatLost,
  isCombatWon,
  playCard,
  startCombat,
} from './combat.js';
import { addStatus } from './effects.js';
import type {
  CardDef,
  ContentRegistry,
  GameAction,
  MapNode,
  Rarity,
  RunState,
  StatusId,
} from './types.js';
import { EngineError } from './types.js';

export interface RunConfig {
  readonly starterDeck: readonly string[];
  readonly maxHp: number;
  readonly startingGold: number;
  readonly startingRelics: readonly string[];
  readonly tempoHint?: number;
  /** Difficulty enemy-HP multiplier (default 1 = neutral). */
  readonly enemyHpMult?: number;
  /** Number of acts (1 = single session, 3 = multi-act arc). Default 1. */
  readonly acts?: number;
}

export function createRun(
  content: ContentRegistry,
  seed: string,
  config: RunConfig,
): RunState {
  const streams = initStreams(seed);
  const [map, rng] = withStream(streams, 'map', (r) =>
    generateMap(r, { tempoHint: config.tempoHint, acts: config.acts ?? 1 }),
  );
  return {
    seed,
    rng,
    map,
    currentNodeId: map.startId,
    phase: 'map',
    hp: config.maxHp,
    maxHp: config.maxHp,
    gold: config.startingGold,
    deck: [...config.starterDeck],
    relics: [...config.startingRelics],
    combat: null,
    reward: null,
    shop: null,
    event: null,
    modifiers: { nextCombatStatuses: {}, queuedEliteIds: [] },
    enemyHpMult: config.enemyHpMult ?? 1,
  };
}

export function applyAction(
  content: ContentRegistry,
  state: RunState,
  action: GameAction,
): RunState {
  switch (action.type) {
    case 'chooseNode':
      return chooseNode(content, state, action.nodeId);
    case 'playCard':
      return inCombat(content, state, (rng, s) =>
        playCard(content, requireCombat(s), action.handIndex, action.targetIndex, rng),
      );
    case 'endTurn':
      return inCombat(content, state, (rng, s) => {
        let combat = endTurn(content, requireCombat(s), rng);
        if (!isCombatWon(combat) && !isCombatLost(combat)) {
          combat = applyRelics(content, combat, s.relics, 'turnStart', rng);
        }
        return combat;
      });
    case 'pickRewardCard': {
      requirePhase(state, 'reward');
      const cardId = state.reward?.cards[action.index];
      if (cardId === undefined) throw new EngineError(`no reward card at ${action.index}`);
      return { ...state, deck: [...state.deck, cardId], reward: null, phase: 'map' };
    }
    case 'skipReward':
      requirePhase(state, 'reward');
      return { ...state, reward: null, phase: 'map' };
    case 'buyCard': {
      requirePhase(state, 'shop');
      const item = state.shop?.stock[action.index];
      if (!item || item.sold) throw new EngineError(`nothing to buy at ${action.index}`);
      if (state.gold < item.price) throw new EngineError('not enough gold');
      return {
        ...state,
        gold: state.gold - item.price,
        deck: [...state.deck, item.cardId],
        shop: {
          stock: state.shop!.stock.map((s, i) =>
            i === action.index ? { ...s, sold: true } : s,
          ),
        },
      };
    }
    case 'leaveShop':
      requirePhase(state, 'shop');
      return { ...state, shop: null, phase: 'map' };
    case 'rest': {
      requirePhase(state, 'rest');
      const healed = Math.min(state.maxHp, state.hp + Math.floor(state.maxHp * 0.2));
      return { ...state, hp: healed, phase: 'map' };
    }
    case 'chooseEventOption': {
      requirePhase(state, 'event');
      return resolveEventOption(content, state, action.index);
    }
  }
}

// ---- node entry ----

function chooseNode(content: ContentRegistry, state: RunState, nodeId: string): RunState {
  requirePhase(state, 'map');
  const current = state.map.nodes[state.currentNodeId];
  if (!current || !current.next.includes(nodeId)) {
    throw new EngineError(`no path from ${state.currentNodeId} to ${nodeId}`);
  }
  const node = state.map.nodes[nodeId] as MapNode;
  const moved = { ...state, currentNodeId: nodeId };

  switch (node.kind) {
    case 'combat': {
      const queued = moved.modifiers.queuedEliteIds;
      const enemyIds = rollEncounter(content, moved, node);
      if (queued.length === 0 || node.row < 3) return enterCombat(content, moved, enemyIds);
      const consumed: RunState = {
        ...moved,
        modifiers: { ...moved.modifiers, queuedEliteIds: queued.slice(1) },
      };
      return enterCombat(content, consumed, [...enemyIds, queued[0] as string]);
    }
    case 'elite':
      return enterRolledCombat(content, moved, 'elite');
    case 'boss':
      return enterRolledCombat(content, moved, 'boss');
    case 'shop':
      return enterShop(content, moved);
    case 'rest':
      return { ...moved, phase: 'rest' };
    case 'event':
      return enterEvent(content, moved);
    case 'start':
      throw new EngineError('cannot re-enter the start node');
  }
}

type PoolKind = 'normal' | 'elite' | 'boss';

function enemyPool(content: ContentRegistry, kind: PoolKind, maxTier = Infinity): string[] {
  return Object.values(content.enemies)
    .filter((e) => {
      const typeOk =
        kind === 'boss' ? e.isBoss : kind === 'elite' ? e.isElite : !e.isBoss && !e.isElite;
      if (!typeOk) return false;
      if (kind === 'normal') return (e.tier ?? 1) <= maxTier;
      return true;
    })
    .map((e) => e.id)
    .sort();
}

function enterRolledCombat(
  content: ContentRegistry,
  state: RunState,
  kind: Exclude<PoolKind, 'normal'>,
): RunState {
  const pool = enemyPool(content, kind);
  if (pool.length === 0) throw new EngineError(`no ${kind} enemies in content`);
  const [enemyId, rng] = withStream(state.rng, 'combat', (r) => r.pick(pool));
  return enterCombat(content, { ...state, rng }, [enemyId]);
}

function rollEncounter(
  content: ContentRegistry,
  state: RunState,
  node: MapNode,
): string[] {
  // Deeper acts admit higher enemy tiers and bigger packs.
  const tiered = enemyPool(content, 'normal', node.act + 1);
  const pool = tiered.length > 0 ? tiered : enemyPool(content, 'normal');
  if (pool.length === 0) throw new EngineError('no normal enemies in content');
  const [ids] = withStream(state.rng, 'combat', (rng) => {
    let count: number;
    if (node.act === 0) count = node.row <= 2 ? 1 : rng.next() < 0.5 ? 1 : 2;
    else if (node.act === 1) count = 2;
    else count = rng.next() < 0.5 ? 2 : 3;
    return Array.from({ length: count }, () => rng.pick(pool));
  });
  return ids;
}

function enterCombat(
  content: ContentRegistry,
  state: RunState,
  enemyIds: readonly string[],
): RunState {
  const [initialCombat, rng] = withStream(state.rng, 'combat', (r) =>
    startCombat(content, state.deck, state.hp, state.maxHp, state.relics, enemyIds, r, state.enemyHpMult),
  );
  let combat = initialCombat;
  // Consume any pending blessing from bounded modifiers.
  const bless = Object.entries(state.modifiers.nextCombatStatuses) as [StatusId, number][];
  let next = state;
  if (bless.length > 0) {
    let statuses = combat.playerStatuses;
    for (const [status, stacks] of bless) statuses = addStatus(statuses, status, stacks);
    combat = { ...combat, playerStatuses: statuses };
    next = { ...state, modifiers: { ...state.modifiers, nextCombatStatuses: {} } };
  }
  return { ...next, rng, combat, phase: 'combat' };
}

function inCombat(
  content: ContentRegistry,
  state: RunState,
  fn: (rng: Rng, state: RunState) => RunState['combat'],
): RunState {
  requirePhase(state, 'combat');
  const [combat, rng] = withStream(state.rng, 'combat', (r) => fn(r, state));
  if (!combat) throw new EngineError('combat handler returned no state');
  const next = { ...state, rng, combat };
  if (isCombatLost(combat)) {
    return { ...next, hp: 0, phase: 'defeat', combat: null };
  }
  if (isCombatWon(combat)) {
    return finishCombat(content, { ...next, hp: combat.playerHp });
  }
  return next;
}

function finishCombat(content: ContentRegistry, state: RunState): RunState {
  const node = state.map.nodes[state.currentNodeId] as MapNode;
  if (node.kind === 'boss') {
    return { ...state, combat: null, phase: 'victory' };
  }
  const isElite = node.kind === 'elite';
  const [reward, rng] = withStream(state.rng, 'loot', (r) => {
    const gold = isElite ? r.intBetween(30, 50) : r.intBetween(15, 30);
    const cards = rollCardChoices(content, r, 3);
    let relicId: string | undefined;
    if (isElite) {
      const unowned = Object.keys(content.relics)
        .filter((id) => !state.relics.includes(id))
        .sort();
      if (unowned.length > 0) relicId = r.pick(unowned);
    }
    return { gold, cards, relicId };
  });
  return {
    ...state,
    rng,
    combat: null,
    gold: state.gold + reward.gold,
    relics: reward.relicId ? [...state.relics, reward.relicId] : state.relics,
    reward: reward.relicId
      ? { cards: reward.cards, gold: reward.gold, relicId: reward.relicId }
      : { cards: reward.cards, gold: reward.gold },
    phase: 'reward',
  };
}

// ---- loot / shop / events ----

const RARITY_WEIGHTS: readonly [Rarity, number][] = [
  ['common', 0.6],
  ['uncommon', 0.3],
  ['rare', 0.1],
];

function rollCardChoices(content: ContentRegistry, rng: Rng, count: number): string[] {
  const byRarity = new Map<Rarity, CardDef[]>();
  for (const card of Object.values(content.cards).sort((a, b) => a.id.localeCompare(b.id))) {
    if (card.rarity === 'starter') continue;
    byRarity.set(card.rarity, [...(byRarity.get(card.rarity) ?? []), card]);
  }
  const choices: string[] = [];
  for (let i = 0; i < count * 10 && choices.length < count; i++) {
    let roll = rng.next();
    let rarity: Rarity = 'common';
    for (const [r, w] of RARITY_WEIGHTS) {
      roll -= w;
      if (roll < 0) {
        rarity = r;
        break;
      }
    }
    const pool = byRarity.get(rarity);
    if (!pool || pool.length === 0) continue;
    const picked = rng.pick(pool);
    if (!choices.includes(picked.id)) choices.push(picked.id);
  }
  return choices;
}

const SHOP_PRICES: Readonly<Record<Rarity, number>> = {
  starter: 0,
  common: 50,
  uncommon: 75,
  rare: 110,
};

function enterShop(content: ContentRegistry, state: RunState): RunState {
  const [stock, rng] = withStream(state.rng, 'loot', (r) =>
    rollCardChoices(content, r, 3).map((cardId) => {
      const card = content.cards[cardId] as CardDef;
      return {
        cardId,
        price: SHOP_PRICES[card.rarity] + r.intBetween(-5, 5),
        sold: false,
      };
    }),
  );
  return { ...state, rng, shop: { stock }, phase: 'shop' };
}

function enterEvent(content: ContentRegistry, state: RunState): RunState {
  const ids = Object.keys(content.events).sort();
  if (ids.length === 0) throw new EngineError('no narrative events in content');
  const [eventId, rng] = withStream(state.rng, 'events', (r) => r.pick(ids));
  return { ...state, rng, event: { eventId }, phase: 'event' };
}

function resolveEventOption(
  content: ContentRegistry,
  state: RunState,
  index: number,
): RunState {
  const def = state.event ? content.events[state.event.eventId] : undefined;
  if (!def) throw new EngineError('no active event');
  const option = def.options[index];
  if (!option) throw new EngineError(`no event option at ${index}`);

  let next: RunState = { ...state, event: null, phase: 'map' };
  for (const outcome of option.outcomes) {
    switch (outcome.kind) {
      case 'gainGold':
        next = { ...next, gold: next.gold + outcome.amount };
        break;
      case 'loseGold':
        next = { ...next, gold: Math.max(0, next.gold - outcome.amount) };
        break;
      case 'loseHp':
        next = { ...next, hp: Math.max(0, next.hp - outcome.amount) };
        break;
      case 'gainMaxHp':
        next = {
          ...next,
          maxHp: next.maxHp + outcome.amount,
          hp: next.hp + outcome.amount,
        };
        break;
      case 'gainCard':
        next = { ...next, deck: [...next.deck, outcome.cardId] };
        break;
      case 'gainRelic':
        next = { ...next, relics: [...next.relics, outcome.relicId] };
        break;
    }
  }
  if (next.hp <= 0) return { ...next, phase: 'defeat' };
  return next;
}

// ---- guards ----

function requirePhase(state: RunState, phase: RunState['phase']): void {
  if (state.phase !== phase) {
    throw new EngineError(`action requires phase ${phase}, but run is in ${state.phase}`);
  }
}

function requireCombat(state: RunState): NonNullable<RunState['combat']> {
  if (!state.combat) throw new EngineError('no combat in progress');
  return state.combat;
}
