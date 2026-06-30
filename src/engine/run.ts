import { generateMap } from './map.js';
import { initStreams, withStream, type Rng } from './rng.js';
import {
  applyRelics,
  endTurn,
  isCombatLost,
  isCombatWon,
  playCard,
  startCombat,
  usePotion,
} from './combat.js';
import { addStatus } from './effects.js';
import { UPGRADE_TARGET_IDS, UNLOCKABLE_CARD_IDS } from './content/cards.js';
import { UNLOCKABLE_RELIC_IDS } from './content/relics.js';
import type {
  CardDef,
  ContentRegistry,
  EventOutcome,
  GameAction,
  MapNode,
  PotionDef,
  Rarity,
  RunState,
  SimpleEventOutcome,
  StatusId,
} from './types.js';
import { EngineError, eventCheckValue, eventRequirementMet } from './types.js';

export interface RunConfig {
  readonly starterDeck: readonly string[];
  readonly maxHp: number;
  readonly startingGold: number;
  readonly startingRelics: readonly string[];
  readonly tempoHint?: number;
  /** Difficulty enemy-HP multiplier (default 1 = neutral). */
  readonly enemyHpMult?: number;
  /**
   * Per-act enemy-HP scalars indexed by `node.act`; multiplied onto `enemyHpMult`.
   * Index 0 MUST be 1.0 so single mode (act 0 only) and the default config stay
   * byte-identical. Missing/undefined → every act uses 1.0 (no-op).
   */
  readonly actHpRamp?: readonly number[];
  /**
   * #34: multiplier on event `loseHp` outcome amounts (difficulty teeth). Default
   * 1 = neutral (normal/story), so the DEFAULT config and normal-seeded replay
   * are byte-identical. Only ever scales the resolved loss; never the rng stream.
   */
  readonly eventLoseHpMult?: number;
  /** Number of acts (1 = single session, 3 = multi-act arc). Default 1. */
  readonly acts?: number;
  /** Potion slot limit (default 3). */
  readonly maxPotions?: number;
  /** Potions the run begins with (default none). */
  readonly startingPotions?: readonly string[];
  /**
   * E2 meta-progression: the set of EXTRA unlockable card/relic ids this run is
   * allowed to draft. Unlockable content NOT in this set stays excluded from the
   * draft/elite-relic pools. Default (omitted/empty) → ALL unlockables locked,
   * so DEFAULT_RUN_CONFIG + the harness draw the core pool byte-identical to
   * pre-E2. Captured onto RunState so a resumed run replays deterministically.
   */
  readonly allowedUnlockIds?: readonly string[];
}

export const DEFAULT_MAX_POTIONS = 3;

export function createRun(
  content: ContentRegistry,
  seed: string,
  config: RunConfig,
): RunState {
  const streams = initStreams(seed);
  // #69 Tiered reveal: the specific event for each event node is rolled HERE, at
  // generation, on the same seeded 'map' stream (right after the topology), and
  // stored on the node — so the map can NAME events and entry never re-rolls.
  // (This shifts the rng stream vs. the old entry-roll; expected + approved.)
  const eventIds = Object.keys(content.events).sort();
  const [map, rng] = withStream(streams, 'map', (r) => {
    const generated = generateMap(r, { tempoHint: config.tempoHint, acts: config.acts ?? 1 });
    if (eventIds.length === 0) return generated;
    const nodes: Record<string, MapNode> = { ...generated.nodes };
    // Stable, deterministic iteration (sorted ids) so the assignment replays.
    for (const id of Object.keys(nodes).sort()) {
      const node = nodes[id] as MapNode;
      if (node.kind === 'event') nodes[id] = { ...node, eventId: r.pick(eventIds) };
    }
    return { ...generated, nodes };
  });
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
    potions: [...(config.startingPotions ?? [])],
    maxPotions: config.maxPotions ?? DEFAULT_MAX_POTIONS,
    combat: null,
    reward: null,
    shop: null,
    event: null,
    modifiers: { nextCombatStatuses: {}, queuedEliteIds: [] },
    enemyHpMult: config.enemyHpMult ?? 1,
    actHpRamp: config.actHpRamp ?? [],
    eventLoseHpMult: config.eventLoseHpMult ?? 1,
    allowedUnlockIds: [...(config.allowedUnlockIds ?? [])],
    stats: { turns: 0, damageDealt: 0, damageTaken: 0, enemiesSlain: 0 },
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
        playCard(content, requireCombat(s), action.handIndex, action.targetIndex, rng, s.relics),
      );
    case 'usePotion':
      return usePotionAction(content, state, action.potionIndex, action.targetIndex);
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
      return {
        ...grantRewardPotion(state),
        deck: [...state.deck, cardId],
        reward: null,
        phase: 'map',
      };
    }
    case 'skipReward':
      requirePhase(state, 'reward');
      return { ...grantRewardPotion(state), reward: null, phase: 'map' };
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
          ...state.shop!,
          stock: state.shop!.stock.map((s, i) =>
            i === action.index ? { ...s, sold: true } : s,
          ),
        },
      };
    }
    case 'buyPotion': {
      requirePhase(state, 'shop');
      const item = state.shop?.potionStock[action.index];
      if (!item || item.sold) throw new EngineError(`no potion to buy at ${action.index}`);
      if (state.gold < item.price) throw new EngineError('not enough gold');
      if (state.potions.length >= state.maxPotions) throw new EngineError('satchel full');
      return {
        ...state,
        gold: state.gold - item.price,
        potions: [...state.potions, item.potionId],
        shop: {
          ...state.shop!,
          potionStock: state.shop!.potionStock.map((s, i) =>
            i === action.index ? { ...s, sold: true } : s,
          ),
        },
      };
    }
    case 'removeCard': {
      requirePhase(state, 'shop');
      if (!state.shop) throw new EngineError('no shop in progress');
      if (state.shop.removeUsed) throw new EngineError('removal already used this shop');
      if (state.gold < SHOP_REMOVAL_COST) throw new EngineError('not enough gold');
      if (state.deck.length <= MIN_DECK_SIZE) throw new EngineError('deck at minimum size');
      const cardId = state.deck[action.deckIndex];
      if (cardId === undefined) throw new EngineError(`no deck card at ${action.deckIndex}`);
      return {
        ...state,
        gold: state.gold - SHOP_REMOVAL_COST,
        deck: state.deck.filter((_, i) => i !== action.deckIndex),
        shop: { ...state.shop, removeUsed: true },
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
    case 'upgradeCard': {
      requirePhase(state, 'rest');
      const cardId = state.deck[action.deckIndex];
      if (cardId === undefined) throw new EngineError(`no deck card at ${action.deckIndex}`);
      const card = content.cards[cardId];
      if (!card) throw new EngineError(`unknown card ${cardId}`);
      const upgradeId = card.upgradeTo;
      if (upgradeId === undefined) throw new EngineError(`${cardId} has no upgrade`);
      if (!content.cards[upgradeId]) throw new EngineError(`unknown upgrade ${upgradeId}`);
      return {
        ...state,
        deck: state.deck.map((id, i) => (i === action.deckIndex ? upgradeId : id)),
        phase: 'map',
      };
    }
    case 'chooseEventOption': {
      requirePhase(state, 'event');
      return chooseEventOption(content, state, action.index);
    }
    case 'continueEvent': {
      requirePhase(state, 'event');
      if (!state.event?.result) throw new EngineError('no event result to continue from');
      return { ...state, event: null, phase: 'map' };
    }
  }
}

// ---- node entry ----

/**
 * Per-act-transition "exhaustion" cost (#32). The dungeon wears you down between
 * acts: when you ADVANCE from one act into the next (in arc/multi-act mode), your
 * MAX HP is permanently lowered by a fixed amount for the rest of the run (and
 * current HP is clamped down with it). This is the #1 balance lever from the
 * playtest: arc winners were arriving at the final boss with ~2x the buffer of
 * single-mode winners (~46 vs ~23 end HP on win), so the boss's 50%-HP phase
 * climax never landed. The toll brings arc end-HP-on-win into the single band.
 *
 * Why MAX HP, not just current HP: a one-time current-HP hit is fully out-rested
 * before the boss (rest sites heal 20% of max, and the agent rests when low), so
 * a pure-HP toll washes out and never moves boss-arrival HP (measured: 28 HP of
 * pure-HP toll moved greedy boss arrival by only ~3 HP). Capping MAX HP makes the
 * wear STICK — rest heals only toward the lowered ceiling — so the climax bites.
 * This needs NO RunState shape change (maxHp already exists) → NO SAVE_VERSION bump.
 *
 * Why this is single-mode safe: single mode is one act (act 0) with NO act
 * transitions, so `toAct > fromAct` is NEVER true there — the toll cannot fire,
 * and single-mode seeded replay stays byte-identical. The cost is a FIXED
 * constant (no rng, no clock), so arc replay is deterministic too. Both hp and
 * maxHp are clamped to >= 1: exhaustion can never kill you between acts.
 */
export const ACT_TRANSITION_EXHAUSTION_HP = 10;

function applyActTransitionExhaustion(
  state: RunState,
  fromAct: number,
  toAct: number,
): RunState {
  if (toAct <= fromAct) return state; // same act, or no advance → never in single mode
  const maxHp = Math.max(1, state.maxHp - ACT_TRANSITION_EXHAUSTION_HP);
  const hp = Math.max(1, Math.min(state.hp, maxHp));
  return maxHp === state.maxHp && hp === state.hp ? state : { ...state, hp, maxHp };
}

function chooseNode(content: ContentRegistry, state: RunState, nodeId: string): RunState {
  requirePhase(state, 'map');
  const current = state.map.nodes[state.currentNodeId];
  if (!current || !current.next.includes(nodeId)) {
    throw new EngineError(`no path from ${state.currentNodeId} to ${nodeId}`);
  }
  const node = state.map.nodes[nodeId] as MapNode;
  const moved = applyActTransitionExhaustion(
    { ...state, currentNodeId: nodeId },
    current.act,
    node.act,
  );

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
  // Effective HP mult = base difficulty mult * this act's ramp scalar. Act 0's
  // scalar is always 1.0 (and the ramp is empty for single/default runs), so the
  // `*1` after-roll scale in startCombat stays a byte-identical no-op there.
  const act = state.map.nodes[state.currentNodeId]?.act ?? 0;
  const effectiveMult = state.enemyHpMult * (state.actHpRamp[act] ?? 1);
  const [initialCombat, rng] = withStream(state.rng, 'combat', (r) =>
    startCombat(content, state.deck, state.hp, state.maxHp, state.relics, enemyIds, r, effectiveMult),
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

function usePotionAction(
  content: ContentRegistry,
  state: RunState,
  potionIndex: number,
  targetIndex: number | undefined,
): RunState {
  requirePhase(state, 'combat');
  const potionId = state.potions[potionIndex];
  if (potionId === undefined) throw new EngineError(`no potion at index ${potionIndex}`);
  const potion = content.potions[potionId] as PotionDef | undefined;
  if (!potion) throw new EngineError(`unknown potion ${potionId}`);
  // Remove the consumed potion first; usePotion validation runs in the combat
  // stream below and throws before any state is committed if the use is illegal.
  const consumed: RunState = {
    ...state,
    potions: state.potions.filter((_, i) => i !== potionIndex),
  };
  return inCombat(content, consumed, (rng, s) =>
    usePotion(potion, requireCombat(s), targetIndex, rng),
  );
}

/** If the resolved reward carries a potion and there's a free slot, add it. */
function grantRewardPotion(state: RunState): RunState {
  const potionId = state.reward?.potionId;
  if (potionId === undefined || state.potions.length >= state.maxPotions) return state;
  return { ...state, potions: [...state.potions, potionId] };
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
  // Fold this combat's scoped counters into the run's cumulative stats EXACTLY
  // ONCE, at resolution (win AND loss). In-progress combats keep their counters
  // on CombatState (serialized) and contribute nothing until they resolve, so
  // there's no double-count and a fatal fight still tallies its damage/turns.
  if (isCombatLost(combat)) {
    return { ...next, hp: 0, phase: 'defeat', combat: null, stats: foldCombatStats(state.stats, combat) };
  }
  if (isCombatWon(combat)) {
    return finishCombat(content, {
      ...next,
      hp: combat.playerHp,
      stats: foldCombatStats(state.stats, combat),
    });
  }
  return next;
}

/** Add a resolved combat's scoped counters to the run's cumulative stats (pure). */
function foldCombatStats(stats: RunState['stats'], combat: NonNullable<RunState['combat']>): RunState['stats'] {
  return {
    turns: stats.turns + combat.turn,
    damageDealt: stats.damageDealt + combat.dealt,
    damageTaken: stats.damageTaken + combat.taken,
    enemiesSlain: stats.enemiesSlain + combat.slain,
  };
}

/**
 * Apply onCombatEnd relics to the RUN after a combat VICTORY. Unlike the combat
 * triggers (which `applyRelics` runs against CombatState on the combat rng
 * stream), the fight is OVER here: effects land on RUN hp (`state.hp`, capped at
 * `state.maxHp`), not on combat state. RNG-FREE by construction — onCombatEnd
 * relics are heal-only, so nothing draws from any rng stream and the combat
 * simulation stays byte-identical whether or not the player owns one. Returns
 * the SAME state reference when nothing heals, so it is a strict no-op for any
 * player who owns no onCombatEnd relic.
 */
function applyRelicsToRun(content: ContentRegistry, state: RunState): RunState {
  let hp = state.hp;
  for (const relicId of state.relics) {
    const relic = content.relics[relicId];
    if (!relic || relic.trigger !== 'onCombatEnd') continue;
    for (const effect of relic.effects) {
      // onCombatEnd has no combat context, so only heal is meaningful. Other
      // kinds (damage/block/applyStatus/draw/gainEnergy) are guarded out.
      if (effect.kind !== 'heal') {
        throw new EngineError(
          `onCombatEnd relic '${relicId}' has unsupported effect '${effect.kind}' (heal-only)`,
        );
      }
      hp = Math.min(state.maxHp, hp + effect.amount);
    }
  }
  return hp === state.hp ? state : { ...state, hp };
}

function finishCombat(content: ContentRegistry, state: RunState): RunState {
  // Post-victory sustain: fire onCombatEnd relics against the RUN (heal-only,
  // rng-free) BEFORE rewards/phase transition. Only reached on combat WIN.
  state = applyRelicsToRun(content, state);
  const node = state.map.nodes[state.currentNodeId] as MapNode;
  if (node.kind === 'boss') {
    return { ...state, combat: null, phase: 'victory' };
  }
  const isElite = node.kind === 'elite';
  const hasPotionSlot = state.potions.length < state.maxPotions;
  const [reward, rng] = withStream(state.rng, 'loot', (r) => {
    const gold = isElite ? r.intBetween(30, 50) : r.intBetween(15, 30);
    const cards = rollCardChoices(content, r, 3, node.act, state.allowedUnlockIds);
    let relicId: string | undefined;
    if (isElite) {
      const allowed = new Set(state.allowedUnlockIds);
      const unowned = Object.keys(content.relics)
        .filter((id) => !state.relics.includes(id))
        // E2: exclude unlockable relics unless this run has earned them. With no
        // unlockable relics owned and none allowed, the filtered list is the same
        // set (in the same sorted order) as pre-E2 → identical r.pick draw.
        .filter((id) => !UNLOCKABLE_RELIC_IDS.has(id) || allowed.has(id))
        .sort();
      if (unowned.length > 0) relicId = r.pick(unowned);
    }
    // Roll the potion LAST so existing gold/card/relic rolls keep their order;
    // only the trailing roll shifts loot fixtures.
    let potionId: string | undefined;
    if (r.int(4) === 0 && hasPotionSlot) potionId = r.pick(potionIds(content));
    return { gold, cards, relicId, potionId };
  });
  const baseReward = { cards: reward.cards, gold: reward.gold };
  return {
    ...state,
    rng,
    combat: null,
    gold: state.gold + reward.gold,
    relics: reward.relicId ? [...state.relics, reward.relicId] : state.relics,
    reward: {
      ...baseReward,
      ...(reward.relicId ? { relicId: reward.relicId } : {}),
      ...(reward.potionId ? { potionId: reward.potionId } : {}),
    },
    phase: 'reward',
  };
}

function potionIds(content: ContentRegistry): string[] {
  return Object.keys(content.potions).sort();
}

// ---- loot / shop / events ----

/**
 * Per-act draft-rarity weights, indexed by `node.act`. Deeper acts skew toward
 * higher rarity to pair with D7's per-act enemy escalation (harder fights, better
 * loot). Each row is [common, uncommon, rare] and MUST sum to ~1.
 *
 * INVARIANT: act 0 MUST stay exactly [0.6, 0.3, 0.1]. Single mode is act 0 only,
 * so this row keeps single-mode reward/shop draws byte-identical to the historical
 * flat weighting (same rng consumption + same weights → same draws). Only deeper
 * acts (arc) change. The tilt is kept MODEST so D7 arc parity is preserved.
 */
export const RARITY_WEIGHTS_BY_ACT: readonly (readonly [Rarity, number][])[] = [
  // act 0 — UNCHANGED (single-mode invariant; do not touch)
  [
    ['common', 0.6],
    ['uncommon', 0.3],
    ['rare', 0.1],
  ],
  // act 1 — modest tilt
  [
    ['common', 0.52],
    ['uncommon', 0.34],
    ['rare', 0.14],
  ],
  // act 2 (deepest authored act; any higher act clamps to this row) — a touch more
  [
    ['common', 0.46],
    ['uncommon', 0.36],
    ['rare', 0.18],
  ],
];

function rarityWeightsForAct(act: number): readonly [Rarity, number][] {
  const idx = Math.max(0, Math.min(act, RARITY_WEIGHTS_BY_ACT.length - 1));
  return RARITY_WEIGHTS_BY_ACT[idx]!;
}

export function rollCardChoices(
  content: ContentRegistry,
  rng: Rng,
  count: number,
  act = 0,
  /**
   * E2: EXTRA unlockable card ids this run is allowed to draft. Unlockable cards
   * NOT listed are excluded from the pool. Default (empty) → all unlockables
   * excluded, so the pool (and thus every rng draw) is byte-identical to pre-E2.
   */
  allowedUnlockIds: readonly string[] = [],
): string[] {
  const weights = rarityWeightsForAct(act);
  const allowed = allowedUnlockIds.length > 0 ? new Set(allowedUnlockIds) : null;
  const byRarity = new Map<Rarity, CardDef[]>();
  for (const card of Object.values(content.cards).sort((a, b) => a.id.localeCompare(b.id))) {
    if (card.rarity === 'starter') continue;
    // Upgraded variants are reachable only by upgrading at a rest — never drafted.
    if (UPGRADE_TARGET_IDS.has(card.id)) continue;
    // E2: unlockable cards stay out of the pool unless this run has earned them.
    // With nothing allowed (default/harness) the iteration produces the exact
    // same per-rarity lists as pre-E2 → identical rng consumption and draws.
    if (UNLOCKABLE_CARD_IDS.has(card.id) && !(allowed && allowed.has(card.id))) continue;
    byRarity.set(card.rarity, [...(byRarity.get(card.rarity) ?? []), card]);
  }
  const choices: string[] = [];
  for (let i = 0; i < count * 10 && choices.length < count; i++) {
    let roll = rng.next();
    let rarity: Rarity = 'common';
    for (const [r, w] of weights) {
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

/** Potion shop prices by rarity (cheaper than cards: a one-shot, not permanent). */
const POTION_PRICES: Readonly<Record<Rarity, number>> = {
  starter: 20,
  common: 35,
  uncommon: 55,
  rare: 80,
};

const SHOP_POTION_COUNT = 2;

/**
 * Gold cost of the shop's one-per-visit card-removal service (#49). Priced like a
 * common card (50g) so deck-thinning is a real economic tradeoff: a removal
 * competes directly with buying a card or a couple of potions, not a no-brainer.
 * Deterministic flat cost (no rng) → seeded replay of non-removing runs unchanged.
 */
export const SHOP_REMOVAL_COST = 50;

/**
 * The deck floor: removal may not shrink the deck to OR below this size. The
 * starter deck is 9 cards; keeping >= 5 leaves a functional minimum hand engine
 * (draw 5) and stops degenerate over-thinning. Removal is rejected when the deck
 * is already at/under the floor.
 */
export const MIN_DECK_SIZE = 5;

function enterShop(content: ContentRegistry, state: RunState): RunState {
  const act = state.map.nodes[state.currentNodeId]?.act ?? 0;
  const [shop, rng] = withStream(state.rng, 'loot', (r) => {
    // Card stock rolls FIRST so existing shop fixtures keep their card rolls;
    // the potion rolls are appended afterwards on the same stream.
    const stock = rollCardChoices(content, r, 3, act, state.allowedUnlockIds).map((cardId) => {
      const card = content.cards[cardId] as CardDef;
      return {
        cardId,
        price: SHOP_PRICES[card.rarity] + r.intBetween(-5, 5),
        sold: false,
      };
    });
    const ids = potionIds(content);
    const potionStock = Array.from({ length: SHOP_POTION_COUNT }, () => {
      const potionId = r.pick(ids);
      const potion = content.potions[potionId] as PotionDef;
      return {
        potionId,
        price: POTION_PRICES[potion.rarity ?? 'common'] + r.intBetween(-5, 5),
        sold: false,
      };
    });
    return { stock, potionStock };
  });
  // removeUsed starts false: the deck-thinning service is available once per
  // shop visit and is reset to false here every time a shop node is entered.
  return { ...state, rng, shop: { ...shop, removeUsed: false }, phase: 'shop' };
}

function enterEvent(content: ContentRegistry, state: RunState): RunState {
  // #69 Tiered reveal: the eventId was decided at map generation and stored on
  // the node. Entry just reads it — NO re-roll (so the named map and the played
  // event always agree, and the rng stream is untouched here).
  const node = state.map.nodes[state.currentNodeId];
  const eventId = node?.eventId;
  if (!eventId || !content.events[eventId]) {
    throw new EngineError(`event node ${state.currentNodeId} has no valid stored eventId`);
  }
  return { ...state, event: { eventId }, phase: 'event' };
}

function chooseEventOption(
  content: ContentRegistry,
  state: RunState,
  index: number,
): RunState {
  const def = state.event ? content.events[state.event.eventId] : undefined;
  if (!def) throw new EngineError('no active event');
  const eventId = state.event!.eventId;
  const option = def.options[index];
  if (!option) throw new EngineError(`no event option at ${index}`);
  if (!eventRequirementMet(state, option.requires)) {
    throw new EngineError(`event option ${index} is not available`);
  }

  // Flatten the chosen outcomes into concrete simple outcomes. Probabilistic
  // rolls draw from the 'events' stream (so replay is byte-identical); the
  // 'events' stream's advanced state is folded back into rng. Conditionals read
  // the pre-resolution player state (a snapshot), keeping resolution order-free.
  const [resolved, rng] = withStream(state.rng, 'events', (r) =>
    flattenOutcomes(option.outcomes, state, r),
  );

  // Apply the simple outcomes immutably (same arithmetic as before). loseHp
  // outcomes are rewritten in `applied` to the ACTUAL loss (after #34 scaling +
  // cap) so the result screen / hints / tests reflect what really happened. On
  // normal (mult 1, cap not reached) loss === base amount → byte-identical.
  let next: RunState = { ...state, rng };
  const applied: SimpleEventOutcome[] = [];
  for (const outcome of resolved.applied) {
    switch (outcome.kind) {
      case 'gainGold':
        next = { ...next, gold: next.gold + outcome.amount };
        applied.push(outcome);
        break;
      case 'loseGold':
        next = { ...next, gold: Math.max(0, next.gold - outcome.amount) };
        applied.push(outcome);
        break;
      case 'loseHp': {
        // #34: scale the loss by the difficulty knob (normal/story = 1.0 →
        // byte-identical; hard 1.25 / nightmare 1.5), then CAP the *added teeth*
        // so a SCALED branch can't exceed 50% of MAX HP — a full-HP player can
        // never be cheaply one-shot, but a warned, wounded player CAN die (the
        // #24 hints show the scaled stakes, so it's informed). Max HP (not
        // current) gives a stable ceiling that doesn't shrink when wounded. The
        // cap floor is the BASE amount, so an event the designer authored as
        // lethal stays lethal and normal (mult 1) is byte-identical (loss ==
        // base ≤ cap). Pure integer arithmetic — no rng drawn, stream unshifted.
        const scaled = Math.floor(outcome.amount * next.eventLoseHpMult);
        const cap = Math.max(outcome.amount, Math.floor(next.maxHp * 0.5));
        const loss = Math.min(scaled, cap);
        next = { ...next, hp: Math.max(0, next.hp - loss) };
        applied.push(loss === outcome.amount ? outcome : { kind: 'loseHp', amount: loss });
        break;
      }
      case 'gainMaxHp':
        next = {
          ...next,
          maxHp: next.maxHp + outcome.amount,
          hp: next.hp + outcome.amount,
        };
        applied.push(outcome);
        break;
      case 'gainCard':
        next = { ...next, deck: [...next.deck, outcome.cardId] };
        applied.push(outcome);
        break;
      case 'gainRelic':
        next = { ...next, relics: [...next.relics, outcome.relicId] };
        applied.push(outcome);
        break;
    }
  }

  // Lethal outcome → straight to defeat (no result screen).
  if (next.hp <= 0) return { ...next, event: null, phase: 'defeat' };

  // Nothing applied (e.g. "Walk away") → straight back to the map.
  if (applied.length === 0) {
    return { ...next, event: null, phase: 'map' };
  }

  // Otherwise stay in the event phase and show a result screen.
  return {
    ...next,
    event: { eventId, result: { applied, rolled: resolved.rolled } },
    phase: 'event',
  };
}

/**
 * Resolve an option's (possibly composite) outcomes into a flat list of simple
 * outcomes. Rolls advance `r` (the 'events' stream); conditionals branch on the
 * passed-in state snapshot. Composites are one level deep — branches/clauses
 * contain only simple outcomes — so no recursion past this single expansion is
 * required.
 */
function flattenOutcomes(
  outcomes: readonly EventOutcome[],
  state: RunState,
  r: Rng,
): { applied: SimpleEventOutcome[]; rolled: boolean } {
  const applied: SimpleEventOutcome[] = [];
  let rolled = false;
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'rollOutcomes': {
        rolled = true;
        const branch = pickBranch(outcome.branches, outcome.weights, r);
        applied.push(...branch);
        break;
      }
      case 'conditional': {
        const pass = eventCheckValue(state, outcome.check) >= outcome.atLeast;
        applied.push(...(pass ? outcome.ifPass : outcome.ifFail));
        break;
      }
      default:
        applied.push(outcome);
        break;
    }
  }
  return { applied, rolled };
}

/** Pick one branch uniformly, or by `weights` if provided, from the 'events' rng. */
function pickBranch(
  branches: readonly (readonly SimpleEventOutcome[])[],
  weights: readonly number[] | undefined,
  r: Rng,
): readonly SimpleEventOutcome[] {
  if (branches.length === 0) return [];
  if (!weights) return r.pick(branches);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = r.next() * total;
  for (let i = 0; i < branches.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return branches[i] as readonly SimpleEventOutcome[];
  }
  return branches[branches.length - 1] as readonly SimpleEventOutcome[];
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
