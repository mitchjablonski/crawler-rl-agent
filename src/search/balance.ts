// Balancing toolkit: use the agent (and weaker proxies) as a tireless playtester.
//
// The core idea is to run many episodes with a *player* policy and collect honest
// statistics — win rate, HP cost, run length, what content gets used, what removing a
// piece of content does. Three reference players span the skill ladder:
//   optimal  (hybrid PUCT)        — the skill ceiling / intrinsic difficulty
//   median   (greedy heuristic)   — a competent-but-imperfect human
//   casual   (no-search policy)   — a fast/careless player
// The *spread between tiers* is the most important balance signal (luck vs. skill).
import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { CHARACTERS } from '../engine/content/characters.js';
import { type Encoder } from './encode.js';
import { greedyAction, greedyRollout } from './heuristic.js';
import { legalActions } from './legalActions.js';
import { type NetParams } from './net.js';
import { policyAction } from './policy.js';
import { puctAction } from './puct.js';

/** A player policy: pick an action for a state. */
export type Player = (content: ContentRegistry, state: RunState) => GameAction;

/**
 * Apply a character's class identity (starter deck + maxHp + starting relics) to a base
 * config. A class is selected purely through these config fields — RunConfig has no
 * `character` field — so this is the single place training/eval pick which class to play.
 */
export function classConfig(classId: string, base: RunConfig): RunConfig {
  const ch = CHARACTERS[classId];
  if (!ch) throw new Error(`unknown class '${classId}'`);
  return { ...base, starterDeck: ch.starterDeck, maxHp: ch.maxHp, startingRelics: ch.startingRelics };
}

/** Median player: the greedy heuristic. Fast; needs no trained model. */
export function greedyPlayer(rand: () => number): Player {
  return (content, state) => greedyAction(state, content, rand);
}

/** Optimal player: hybrid PUCT (net priors + honest greedy-rollout leaf value). */
export function hybridPlayer(
  encoder: Encoder,
  net: NetParams,
  rand: () => number,
  iterations = 160,
): Player {
  return (content, state) =>
    puctAction(content, state, { encoder, net, iterations, rand, leafRollout: greedyRollout });
}

/** Casual player: a single net forward pass, no search. */
export function policyPlayer(encoder: Encoder, net: NetParams): Player {
  return (content, state) => policyAction(content, state, encoder, net);
}

export interface EpisodeMetrics {
  readonly won: boolean;
  /** Total actions taken (a rough run-length proxy). */
  readonly steps: number;
  /** Number of endTurn actions — "turns played", a grind proxy. */
  readonly turns: number;
  /** Cumulative player HP lost (sum of per-step HP drops). */
  readonly damageTaken: number;
  readonly finalHp: number;
  readonly finalGold: number;
  /** Deepest act / row reached (0-indexed act). */
  readonly deepestAct: number;
  readonly deepestRow: number;
}

const STEP_CAP = 6000;

function isTerminal(s: RunState): boolean {
  return s.phase === 'victory' || s.phase === 'defeat';
}

/** Apply an action, falling back to the first legal action if the engine rejects it. */
function safeApply(content: ContentRegistry, s: RunState, a: GameAction): RunState {
  try {
    return applyAction(content, s, a);
  } catch (err) {
    if (!(err instanceof EngineError)) throw err;
    const legal = legalActions(content, s);
    if (legal.length === 0) return s;
    return applyAction(content, s, legal[0] as GameAction);
  }
}

/**
 * Run one episode with `player`, optionally calling `onTransition(prev, action, next)`
 * after each step (used by telemetry to attribute usage / damage). Returns run metrics.
 */
export function runEpisode(
  content: ContentRegistry,
  seed: string,
  config: RunConfig,
  player: Player,
  onTransition?: (prev: RunState, action: GameAction, next: RunState) => void,
): EpisodeMetrics {
  let s = createRun(content, seed, config);
  let steps = 0;
  let turns = 0;
  let damageTaken = 0;
  let deepestAct = 0;
  let deepestRow = 0;
  const track = (st: RunState): void => {
    const node = st.map.nodes[st.currentNodeId];
    if (node) {
      if (node.act > deepestAct) deepestAct = node.act;
      if (node.row > deepestRow) deepestRow = node.row;
    }
  };
  track(s);
  for (; steps < STEP_CAP && !isTerminal(s); steps++) {
    let action: GameAction;
    try {
      action = player(content, s);
    } catch {
      const legal = legalActions(content, s);
      if (legal.length === 0) break;
      action = legal[0] as GameAction;
    }
    if (action.type === 'endTurn') turns++;
    const prev = s;
    s = safeApply(content, s, action);
    if (s === prev) break; // no progress (illegal + no legal fallback) — avoid an infinite loop
    if (s.hp < prev.hp) damageTaken += prev.hp - s.hp;
    track(s);
    onTransition?.(prev, action, s);
  }
  return {
    won: s.phase === 'victory',
    steps,
    turns,
    damageTaken,
    finalHp: s.hp,
    finalGold: s.gold,
    deepestAct,
    deepestRow,
  };
}

export interface AggregateMetrics {
  readonly runs: number;
  readonly winRate: number;
  readonly avgDamageTaken: number;
  readonly avgTurns: number;
  readonly avgFinalGold: number;
  /** Average win-adjusted depth: deepest act reached (helps read *how far* losers get). */
  readonly avgDeepestAct: number;
}

/** Aggregate `runEpisode` over a set of seeds. */
export function evaluatePlayer(
  content: ContentRegistry,
  config: RunConfig,
  player: Player,
  seeds: readonly string[],
): AggregateMetrics {
  if (seeds.length === 0) {
    return { runs: 0, winRate: 0, avgDamageTaken: 0, avgTurns: 0, avgFinalGold: 0, avgDeepestAct: 0 };
  }
  let wins = 0;
  let dmg = 0;
  let turns = 0;
  let gold = 0;
  let act = 0;
  for (const seed of seeds) {
    const m = runEpisode(content, seed, config, player);
    if (m.won) wins++;
    dmg += m.damageTaken;
    turns += m.turns;
    gold += m.finalGold;
    act += m.deepestAct;
  }
  const n = seeds.length;
  return {
    runs: n,
    winRate: wins / n,
    avgDamageTaken: dmg / n,
    avgTurns: turns / n,
    avgFinalGold: gold / n,
    avgDeepestAct: act / n,
  };
}

// ---- Content telemetry: what the player actually uses ----

export interface UsageCounts {
  /** card id -> times drafted from a reward screen. */
  readonly picked: Map<string, number>;
  /** card id -> times bought in a shop. */
  readonly bought: Map<string, number>;
  /** card id -> times played in combat. */
  readonly played: Map<string, number>;
  /** card id -> times upgraded at a rest. */
  readonly upgraded: Map<string, number>;
  /** potion id -> times used in combat. */
  readonly potionUsed: Map<string, number>;
  /** potion id -> times bought in a shop. */
  readonly potionBought: Map<string, number>;
  /** enemy id -> player HP lost while it was on the field, SHARED across co-occurring alive
   *  enemies (loss/aliveCount per step) so multi-enemy fights aren't double-counted. */
  readonly enemyDamage: Map<string, number>;
  /** enemy id -> combat steps it was present for (to normalize enemyDamage). */
  readonly enemySteps: Map<string, number>;
}

export function emptyUsage(): UsageCounts {
  return {
    picked: new Map(),
    bought: new Map(),
    played: new Map(),
    upgraded: new Map(),
    potionUsed: new Map(),
    potionBought: new Map(),
    enemyDamage: new Map(),
    enemySteps: new Map(),
  };
}

const bump = (m: Map<string, number>, k: string | undefined, by = 1): void => {
  if (k !== undefined) m.set(k, (m.get(k) ?? 0) + by);
};

/**
 * Telemetry hook for `runEpisode`. Decodes which concrete card/potion/enemy each action
 * touched (from the pre-action state) and accumulates usage + per-enemy damage into `u`.
 */
export function telemetryHook(u: UsageCounts) {
  return (prev: RunState, action: GameAction, next: RunState): void => {
    switch (action.type) {
      case 'pickRewardCard':
        bump(u.picked, prev.reward?.cards[action.index]);
        break;
      case 'buyCard':
        bump(u.bought, prev.shop?.stock[action.index]?.cardId);
        break;
      case 'playCard':
        bump(u.played, prev.combat?.hand[action.handIndex]);
        break;
      case 'upgradeCard':
        bump(u.upgraded, prev.deck[action.deckIndex]);
        break;
      case 'usePotion':
        bump(u.potionUsed, prev.potions[action.potionIndex]);
        break;
      case 'buyPotion':
        bump(u.potionBought, prev.shop?.potionStock[action.index]?.potionId);
        break;
    }
    // Attribute player HP loss this step across the alive enemies on the field. Splitting by
    // the alive count (rather than crediting each the full loss) keeps the per-enemy totals from
    // double-counting in multi-enemy fights, so the lethality metric isn't inflated.
    const loss = prev.hp - next.hp;
    const alive = (prev.combat?.enemies ?? []).filter((e) => e.hp > 0);
    const share = alive.length > 0 ? loss / alive.length : 0;
    for (const e of alive) {
      bump(u.enemySteps, e.defId);
      if (loss > 0) bump(u.enemyDamage, e.defId, share);
    }
  };
}

// ---- Ablation: nerf a piece of content and measure the win-rate delta ----

/**
 * Return a shallow clone of `content` with one card neutralized — kept in every draw
 * pool (so rng draw order is preserved) but stripped of its effects and set to a high
 * cost, i.e. a near-dead option. The win-rate delta vs. baseline is the card's
 * contribution: a big drop = load-bearing/over-relied; ~0 = irrelevant or dead content.
 */
export function nerfCard(content: ContentRegistry, cardId: string): ContentRegistry {
  const card = content.cards[cardId];
  if (!card) return content;
  return {
    ...content,
    cards: { ...content.cards, [cardId]: { ...card, effects: [], cost: 99 } },
  };
}

/** Like nerfCard but for a relic — strip its effects so holding it does nothing. */
export function nerfRelic(content: ContentRegistry, relicId: string): ContentRegistry {
  const relic = content.relics[relicId];
  if (!relic) return content;
  return {
    ...content,
    relics: { ...content.relics, [relicId]: { ...relic, effects: [] } },
  };
}

/** Like nerfCard but for a potion — strip its effects so using it does nothing. */
export function nerfPotion(content: ContentRegistry, potionId: string): ContentRegistry {
  const potion = content.potions[potionId];
  if (!potion) return content;
  return {
    ...content,
    potions: { ...content.potions, [potionId]: { ...potion, effects: [] } },
  };
}
