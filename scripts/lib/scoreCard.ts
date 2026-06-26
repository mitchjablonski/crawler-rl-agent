/**
 * Heuristic draft-value scorer for the dev playtest harness (NOT shipped).
 *
 * Increment #39: the greedy playtest policy used to pick reward cards BLIND
 * (`pickRewardCard index 0`), so its `pickRate` measured offer ORDER, not card
 * value — pure noise, uncorrelated with MCTS. This gives greedy a cheap, pure,
 * deterministic estimate of a card's draft strength from STATIC data so it
 * drafts the best-scored offered card. The result is a real (if approximate)
 * card-value signal without paying for full MCTS on every sweep.
 *
 * The score is NOT meant to be optimal — only CORRELATED with real strength so
 * `pickRate` stops being blind. It is a pure function of card (+ optional deck)
 * data: no RNG, no clock, no engine mutation. Tooling-only.
 */
import type { CardDef, Effect, StatusId } from '../../src/engine/types.js';

/** Multiplicative weight by rarity — strictly increasing, the dominant factor. */
const RARITY_WEIGHT: Record<CardDef['rarity'], number> = {
  starter: 0.6,
  common: 1.0,
  uncommon: 1.35,
  rare: 1.8,
};

/**
 * Per-stack value of each status. Tuned to rough archetype strength: poison and
 * strength/dexterity scale (so weighted up), vulnerable/weak are strong debuffs,
 * regen is steady value. These are raw "points" added to a card's effect value.
 */
const STATUS_VALUE: Record<StatusId, number> = {
  strength: 3.0, // scales every future attack — high
  dexterity: 2.6, // scales every future block — high
  poison: 1.6, // ramping damage over the fight
  regen: 1.4, // sustain per turn
  vulnerable: 1.5, // +50% incoming dmg, strong tempo
  weak: 1.2, // -25% enemy dmg, defensive tempo
};

/** Cards that hit the whole pack are worth more than single-target — a flat bonus. */
const AOE_MULT = 1.4;
/** Raw points for a single card draw (cantrip/tempo: replaces itself + digs). */
const DRAW_VALUE = 2.2;
/** Raw points for +1 energy (frees a future play; close to a draw in tempo). */
const ENERGY_VALUE = 3.0;
/** Each damage point is worth this; block slightly less (situational). */
const DAMAGE_VALUE = 1.0;
const BLOCK_VALUE = 0.85;
/** Heal is overworld-relevant but weak in-combat vs block — discounted. */
const HEAL_VALUE = 0.7;

/** Sum the raw (pre-rarity, pre-cost) value of a single effect. */
function effectValue(e: Effect): number {
  switch (e.kind) {
    case 'damage': {
      const hits = e.times ?? 1;
      const raw = e.amount * hits * DAMAGE_VALUE;
      return e.target === 'allEnemies' ? raw * AOE_MULT : raw;
    }
    case 'block':
      return e.amount * BLOCK_VALUE;
    case 'draw':
      return e.count * DRAW_VALUE;
    case 'gainEnergy':
      return e.amount * ENERGY_VALUE;
    case 'heal':
      return e.amount * HEAL_VALUE;
    case 'applyStatus': {
      const raw = e.stacks * STATUS_VALUE[e.status];
      return e.target === 'allEnemies' ? raw * AOE_MULT : raw;
    }
    default:
      return 0;
  }
}

/**
 * Minimal context the scorer can use for a light deck-need signal. Optional —
 * passing nothing still yields a sensible static score.
 */
export interface DeckContext {
  /** Card ids currently in the deck (any zone). Used only for cheap need signals. */
  readonly deck?: readonly string[];
  /** Lookup so we can read the type of cards already in the deck. */
  readonly cards?: Readonly<Record<string, CardDef>>;
}

/**
 * Estimate a card's DRAFT value (higher = better to take). Pure & deterministic.
 *
 * value = (sum of effect values)
 *         / costDivisor(cost)        // value-per-energy efficiency
 *         * rarityWeight             // dominant rarity factor
 *         + deckNeedBonus            // small, optional cost/type-curve nudge
 *
 * costDivisor treats 0-cost as ~0.7 energy (free plays are premium) and
 * penalizes dead-weight high cost mildly (value must clear the energy bar).
 */
export function scoreCard(card: CardDef, ctx: DeckContext = {}): number {
  const rawValue = card.effects.reduce((sum, e) => sum + effectValue(e), 0);

  // Cost efficiency: value per energy. 0-cost is premium (clamp to 0.7 so free
  // cards aren't infinite); higher cost must clear a higher bar.
  const costDivisor = Math.max(0.7, card.cost);
  const efficiency = rawValue / costDivisor;

  let score = efficiency * RARITY_WEIGHT[card.rarity];

  // Light, cheap deck-need signal: small bonus for a card TYPE the deck is thin
  // on (cost-curve / archetype balance). Deterministic, never dominates rarity.
  if (ctx.deck && ctx.cards && ctx.deck.length > 0) {
    let attacks = 0;
    let skills = 0;
    let powers = 0;
    for (const id of ctx.deck) {
      const c = ctx.cards[id];
      if (!c) continue;
      if (c.type === 'attack') attacks++;
      else if (c.type === 'skill') skills++;
      else powers++;
    }
    const total = attacks + skills + powers;
    // Fraction this card's type already occupies; reward filling a gap.
    const frac =
      card.type === 'attack' ? attacks / total : card.type === 'skill' ? skills / total : powers / total;
    // Powers are rare/expensive to acquire — a small flat draft nudge for them.
    const powerNudge = card.type === 'power' ? 0.5 : 0;
    score += (0.4 - frac) * 1.5 + powerNudge;
  }

  return score;
}
