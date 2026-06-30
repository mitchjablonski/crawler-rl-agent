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
 * regen COMPOUNDS over the fight. These are raw "points" added to effect value.
 *
 * #53: regen was UNDER-valued at 1.4 — the scorer treated `regen N` like a
 * one-shot N points, but regen heals N HP EVERY turn for the rest of the fight,
 * so its true worth is cumulative (≈ N * remaining-turns), not one-time. Greedy
 * therefore never drafted iron-hide/troll-blood (pickRate ~0) while MCTS (the
 * arbiter) values them ~0.25-0.46. Raised 1.4 -> 2.1 per stack: a single,
 * regen-gated multiplier (no other status/effect weighting touched) that lifts
 * iron-hide greedy pickRate to ~0.43 and troll-blood to ~0.26 — into their MCTS
 * bands — WITHOUT over-boosting them to dominance. 2.1 (not higher) keeps the
 * 1-cost uncommon iron-hide from leaping past its ~0.46 MCTS ceiling.
 */
const STATUS_VALUE: Record<StatusId, number> = {
  strength: 3.0, // scales every future attack — high
  dexterity: 2.6, // scales every future block — high
  poison: 1.6, // ramping damage over the fight
  regen: 2.1, // sustain EVERY turn — compounds over the fight (#53)
  vulnerable: 1.5, // +50% incoming dmg, strong tempo
  weak: 1.2, // -25% enemy dmg, defensive tempo
  // #68 overcharge has NO static worth — its value is entirely synergy-driven
  // (Strength per overheat) and is added as a deck-context bonus in scoreCard,
  // proportional to how many `loseHp` cards the deck runs. 0 here so a synergy-
  // blind score (no deck) treats overdrive-core as near-worthless — the point.
  overcharge: 0,
};

/**
 * #68 overcharge synergy: each `loseHp` card in the deck is worth this much extra
 * draft value PER overcharge stack a card grants — because that card will, over a
 * fight, convert that overheat into a stack of Strength. Each loseHp card is thus
 * worth ~one future Strength stack, so it is valued at the per-stack STRENGTH rate
 * (STATUS_VALUE.strength). This makes overdrive-core score like a real rare ONLY
 * in an overheat deck (several loseHp cards) and ~0 in a Knight/Apothecary deck
 * (no loseHp — the bonus is multiplied by 0), making greedy class-aware for it.
 */
const OVERCHARGE_PER_LOSEHP = STATUS_VALUE.strength;

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
/**
 * #63 overheat: `loseHp` is a self-COST, not raw tempo — it is YOUR hp and it
 * floors at 1 (never lethal), so each point is a modest negative. Cheaper than a
 * point of enemy damage is worth positively (it's risk, not board impact), but
 * real enough that greedy doesn't treat overheat cards as free.
 */
const LOSE_HP_VALUE = -0.5;
/**
 * #63 gradient: a static scorer has no combat state, so `scaleMissingHp` (the
 * `+floor(missingHp/N)` bonus) is approximated at a MODERATE missing-HP estimate
 * — not full missing (over-values) nor zero (under-values). 18 missing HP is a
 * typical mid-fight wound for a ~60-HP aggressor; the estimated bonus
 * `floor(18/N)` is added to the effect amount and valued like the rest of it.
 */
const ASSUMED_MISSING_HP = 18;

/** The estimated flat amount a `scaleMissingHp` divisor adds at a typical wound. */
function scaleBonus(divisor: number | undefined): number {
  if (divisor === undefined) return 0;
  return Math.floor(ASSUMED_MISSING_HP / divisor);
}

/** Sum the raw (pre-rarity, pre-cost) value of a single effect. */
function effectValue(e: Effect): number {
  switch (e.kind) {
    case 'damage': {
      const hits = e.times ?? 1;
      const raw = (e.amount + scaleBonus(e.scaleMissingHp)) * hits * DAMAGE_VALUE;
      return e.target === 'allEnemies' ? raw * AOE_MULT : raw;
    }
    case 'block':
      return (e.amount + scaleBonus(e.scaleMissingHp)) * BLOCK_VALUE;
    case 'loseHp':
      return e.amount * LOSE_HP_VALUE;
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
    case 'conditional': {
      // #42: score the `then` branch at a discount — the bonus only fires when
      // the condition holds (set-up / single-target), so it's worth less than an
      // unconditional effect but still a real draft signal (else is the floor).
      const CONDITIONAL_WEIGHT = 0.6;
      const thenVal = e.then.reduce((s, inner) => s + effectValue(inner), 0);
      const elseVal = (e.else ?? []).reduce((s, inner) => s + effectValue(inner), 0);
      return elseVal + (thenVal - elseVal) * CONDITIONAL_WEIGHT;
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
 * costDivisor: a 0-cost card is a FREE PLAY — you cast it on top of your other
 * plays at no opportunity cost, so it's worth strictly MORE per point of raw
 * value than a 1-cost card, not merely "cheap". #48: the old `max(0.7, cost)`
 * treated 0-cost as ~0.7 energy and UNDER-valued these "cantrip" cards — greedy
 * never drafted known-strong 0-cost cards (throwing-knife, venom-dart) that MCTS
 * (the arbiter) loves. We now divide 0-cost by 0.45 (a free-play premium), while
 * 1+ cost is unchanged at `max(0.7, cost)` so the fix is strictly gated to
 * cost===0 and cheaper-still-beats-pricier ordering stays sane. 0.45 lifts the
 * 0-cost band to ~2.2x a 1-cost card of equal raw value — a real draft premium
 * without making free cards absurdly dominant over efficient 1-cost staples.
 */
export function scoreCard(card: CardDef, ctx: DeckContext = {}): number {
  const rawValue = card.effects.reduce((sum, e) => sum + effectValue(e), 0);

  // Cost efficiency: value per energy. A 0-cost card is a free play (premium —
  // no opportunity cost), so it gets a SMALLER divisor (0.45) than a 1-cost card;
  // 1+ cost is unchanged. Gated to cost===0 so non-zero cards aren't boosted.
  const costDivisor = card.cost === 0 ? 0.45 : Math.max(0.7, card.cost);
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

    // #68 overcharge synergy: value an overcharge-granting card (overdrive-core)
    // by the deck's overheat density — # of `loseHp` cards it already runs. With
    // no loseHp cards (Knight/Apothecary) this is 0, so greedy no longer
    // auto-picks it cross-class; in an overheat deck it scales into a real rare.
    const overchargeStacks = card.effects.reduce(
      (s, e) => s + (e.kind === 'applyStatus' && e.status === 'overcharge' ? e.stacks : 0),
      0,
    );
    if (overchargeStacks > 0) {
      const loseHpCards = ctx.deck.reduce((n, id) => {
        const c = ctx.cards?.[id];
        return n + (c && c.effects.some((e) => e.kind === 'loseHp') ? 1 : 0);
      }, 0);
      score += overchargeStacks * loseHpCards * OVERCHARGE_PER_LOSEHP;
    }
  }

  return score;
}
