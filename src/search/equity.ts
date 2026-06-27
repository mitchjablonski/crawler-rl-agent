// Value-head equity screen: a fast, survivorship-free power estimate.
//
// The net's value head V(s) ≈ P(win). To score a card, sample real states, add one copy
// of the card to the deck, re-encode, and read the equity swing ΔV = V(deck+card) − V(s),
// averaged over states. No rollouts, no full episodes, no survivorship confound — just the
// agent's learned sense of "does having this card raise my win probability here". A cheap
// pre-filter to rank all content before spending ablation budget on the extremes.
//
// CAVEAT: this reflects only what the value head learned (calibration matters), so it
// screens, it does not conclude. Pair with ablation (causal) for the top/bottom items.
import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import type { ContentRegistry, RunState } from '../engine/types.js';
import { legalActions } from './legalActions.js';
import type { Encoder } from './encode.js';
import { type NetParams, forward } from './net.js';
import { type Player } from './balance.js';

/** Collect non-terminal states along `player`'s trajectories (one snapshot every `stride` steps). */
export function sampleStates(
  content: ContentRegistry,
  player: Player,
  specs: ReadonlyArray<{ seed: string; config: RunConfig }>,
  stride = 4,
  cap = 2000,
): RunState[] {
  const out: RunState[] = [];
  for (const { seed, config } of specs) {
    let s = createRun(content, seed, config);
    for (let i = 0; i < 6000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      if (i % stride === 0) out.push(s);
      if (out.length >= cap) return out;
      let a;
      try {
        a = player(content, s);
      } catch {
        const legal = legalActions(content, s);
        if (legal.length === 0) break;
        a = legal[0]!;
      }
      try {
        s = applyAction(content, s, a);
      } catch {
        const legal = legalActions(content, s);
        if (legal.length === 0) break;
        s = applyAction(content, s, legal[0]!);
      }
    }
  }
  return out;
}

/** V(s) from the value head. */
function value(net: NetParams, encoder: Encoder, s: RunState): number {
  return forward(net, encoder.encode(s)).value;
}

/** A state with one extra copy of `cardId` appended to the deck (pure clone). */
function withCard(s: RunState, cardId: string): RunState {
  return { ...s, deck: [...s.deck, cardId] };
}

export interface EquityScore {
  readonly cardId: string;
  /** Mean ΔV = V(deck+card) − V(deck) over the sampled states (value-head units, ≈ Δ win prob). */
  readonly meanDelta: number;
  /** Std error of the mean — gauge of how stable the estimate is. */
  readonly seDelta: number;
  readonly states: number;
}

/**
 * Score every non-starter card by the average value-head equity of adding one copy to the
 * deck across `states`. Returns scores sorted high→low (strongest first).
 */
export function cardEquity(
  content: ContentRegistry,
  encoder: Encoder,
  net: NetParams,
  states: readonly RunState[],
): EquityScore[] {
  const cardIds = Object.keys(content.cards)
    .filter((id) => content.cards[id]?.rarity !== 'starter')
    .sort();
  const base = states.map((s) => value(net, encoder, s));
  const out: EquityScore[] = [];
  for (const cardId of cardIds) {
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < states.length; i++) {
      const d = value(net, encoder, withCard(states[i]!, cardId)) - base[i]!;
      sum += d;
      sumSq += d * d;
    }
    const n = Math.max(1, states.length);
    const mean = sum / n;
    const varc = Math.max(0, sumSq / n - mean * mean);
    out.push({ cardId, meanDelta: mean, seDelta: Math.sqrt(varc / n), states: states.length });
  }
  out.sort((a, b) => b.meanDelta - a.meanDelta);
  return out;
}
