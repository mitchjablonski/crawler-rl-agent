// Value-head calibration: does the net's predicted win probability match REALITY?
//
// The value head is trained on determinized targets — a mix of qDeterminized (an unbiased MC
// estimate of the greedy policy's win) and ismctsSearch.rootValue (a determinized search value
// that can be strategy-fusion *overconfident*). If those targets are biased, the value head will
// systematically over-predict. We test this directly: for sampled states, compare the predicted
// V(s) against the realized greedy win probability (honest MC over re-seeded futures). A reliability
// diagram + expected calibration error (ECE) + net over/under-confidence quantifies the bias.
import { applyAction } from '../engine/run.js';
import { EngineError } from '../engine/types.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { reseed } from './determinized.js';
import { greedyRollout } from './heuristic.js';
import { legalActions } from './legalActions.js';
import type { RolloutPolicy } from './mcts.js';
import type { Encoder } from './encode.js';
import { type NetParams, forward } from './net.js';

/** Play `rollout` to a terminal phase from `start`; 1 = victory, 0 = otherwise. */
function rolloutWin(content: ContentRegistry, start: RunState, rollout: RolloutPolicy, rand: () => number): number {
  let s = start;
  for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
    let a: GameAction;
    try {
      a = rollout(content, s, rand);
    } catch {
      break;
    }
    try {
      s = applyAction(content, s, a);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      const legal = legalActions(content, s);
      if (legal.length === 0) break;
      s = applyAction(content, s, legal[0] as GameAction);
    }
  }
  return s.phase === 'victory' ? 1 : 0;
}

/** Realized win probability of `rollout` from `state`, over `reseeds` re-seeded futures. */
export function realizedWin(
  content: ContentRegistry,
  state: RunState,
  reseeds: number,
  rand: () => number,
  rollout: RolloutPolicy = greedyRollout,
): number {
  let w = 0;
  for (let i = 0; i < reseeds; i++) w += rolloutWin(content, reseed(state, rand), rollout, rand);
  return w / Math.max(1, reseeds);
}

export interface CalibrationBin {
  readonly lo: number;
  readonly hi: number;
  readonly n: number;
  readonly meanPred: number;
  readonly meanReal: number;
}

export interface CalibrationResult {
  readonly n: number;
  /** Mean predicted V(s) across states. */
  readonly meanPred: number;
  /** Mean realized win probability across states. */
  readonly meanReal: number;
  /** meanPred − meanReal: > 0 = overconfident value head (biased-high targets). */
  readonly overconfidence: number;
  /** Expected calibration error: Σ (nᵢ/N)·|meanPredᵢ − meanRealᵢ|. */
  readonly ece: number;
  readonly bins: CalibrationBin[];
}

/**
 * Bin states by predicted V(s) and compare to realized greedy win probability. `realized` is a
 * supplied array (so the expensive rollouts can be computed once / in parallel by the caller),
 * paired index-for-index with `states`.
 */
export function calibrate(
  encoder: Encoder,
  net: NetParams,
  states: readonly RunState[],
  realized: readonly number[],
  nbins = 10,
): CalibrationResult {
  return binCalibration(
    states.map((s) => forward(net, encoder.encode(s)).value),
    realized,
    nbins,
  );
}

/** Pure reliability-diagram math over (predicted, realized) pairs. */
export function binCalibration(
  preds: readonly number[],
  realized: readonly number[],
  nbins = 10,
): CalibrationResult {
  const n = preds.length;
  const bins: CalibrationBin[] = [];
  let ece = 0;
  for (let b = 0; b < nbins; b++) {
    const lo = b / nbins;
    const hi = (b + 1) / nbins;
    let cnt = 0;
    let sp = 0;
    let sr = 0;
    for (let i = 0; i < n; i++) {
      const p = preds[i] ?? 0;
      // last bin is closed on the right so p===1 lands somewhere
      if (p >= lo && (p < hi || (b === nbins - 1 && p <= hi))) {
        cnt++;
        sp += p;
        sr += realized[i] ?? 0;
      }
    }
    const meanPred = cnt > 0 ? sp / cnt : 0;
    const meanReal = cnt > 0 ? sr / cnt : 0;
    if (cnt > 0) ece += (cnt / Math.max(1, n)) * Math.abs(meanPred - meanReal);
    bins.push({ lo, hi, n: cnt, meanPred, meanReal });
  }
  const meanPred = n > 0 ? preds.reduce((a, p) => a + p, 0) / n : 0;
  const meanReal = n > 0 ? realized.reduce((a, r) => a + r, 0) / n : 0;
  return { n, meanPred, meanReal, overconfidence: meanPred - meanReal, ece, bins };
}
