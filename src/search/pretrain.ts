import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import type { ContentRegistry, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import type { RolloutPolicy } from './mcts.js';
import { mctsExpertSearch } from './mctsExpert.js';
import { type NetParams, type TrainSample, type TrainStats, trainStep } from './net.js';

export type ValueTargetMode = 'terminal' | 'root' | 'blend';

export interface MctsExpertOptions {
  readonly content: ContentRegistry;
  readonly encoder: Encoder;
  readonly config: RunConfig;
  readonly iterations: number;
  readonly rand: () => number;
  readonly rollout?: RolloutPolicy;
  readonly maxSteps?: number;
  /** Visit-count sampling temperature (>0). Default 1. */
  readonly temperature?: number;
  /** Sample for the first N plies, then play argmax. Default 8. */
  readonly temperatureMoves?: number;
  /** How to set the value target. Default 'blend'. */
  readonly valueTargetMode?: ValueTargetMode;
  /** Weight on terminal z when mode='blend' (rest on root value). Default 0.5. */
  readonly valueBlend?: number;
}

interface PendingSample {
  readonly x: Float32Array;
  readonly pi: Float32Array;
  readonly mask: Float32Array;
  readonly rootValue: number;
}

function sampleSlot(visits: Float32Array, tau: number, rand: () => number): number {
  const w = new Float64Array(visits.length);
  let totalW = 0;
  for (let i = 0; i < visits.length; i++) {
    const vi = visits[i] ?? 0;
    if (vi > 0) {
      const x = Math.pow(vi, 1 / tau);
      w[i] = x;
      totalW += x;
    }
  }
  if (totalW <= 0) return -1;
  let r = rand() * totalW;
  for (let i = 0; i < visits.length; i++) {
    r -= w[i] ?? 0;
    if (r <= 0) return i;
  }
  return -1;
}

/** Play an episode with the MCTS expert; record (x, visit-distribution pi, mask, value target). */
export function mctsExpertEpisode(seed: string, opts: MctsExpertOptions): TrainSample[] {
  const tau = opts.temperature ?? 1;
  const tauMoves = opts.temperatureMoves ?? 8;
  const mode = opts.valueTargetMode ?? 'blend';
  const blend = opts.valueBlend ?? 0.5;

  let state: RunState = createRun(opts.content, seed, opts.config);
  const pending: PendingSample[] = [];
  const cap = opts.maxSteps ?? 4000;
  for (let step = 0; step < cap && state.phase !== 'victory' && state.phase !== 'defeat'; step++) {
    const result = mctsExpertSearch(opts.content, state, {
      iterations: opts.iterations,
      rand: opts.rand,
      rollout: opts.rollout,
    });
    const { mask, actions } = actionMask(opts.content, state);

    let total = 0;
    for (const vn of result.visits) total += vn;
    const pi = new Float32Array(ACTION_SPACE);
    if (total > 0) for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (result.visits[i] ?? 0) / total;

    pending.push({ x: opts.encoder.encode(state), pi, mask, rootValue: result.rootValue });

    let played = result.action;
    if (step < tauMoves && tau > 0 && total > 0) {
      const slot = sampleSlot(result.visits, tau, opts.rand);
      const sampled = slot >= 0 ? actions[slot] : null;
      if (sampled) played = sampled;
    }
    state = applyAction(opts.content, state, played);
  }

  const z = state.phase === 'victory' ? 1 : 0;
  return pending
    .filter((s) => s.pi.some((p) => p > 0))
    .map((s) => {
      const valueTarget =
        mode === 'terminal'
          ? z
          : mode === 'root'
            ? s.rootValue
            : blend * z + (1 - blend) * s.rootValue;
      return { x: s.x, pi: s.pi, mask: s.mask, z: valueTarget };
    });
}

export interface PretrainOptions extends MctsExpertOptions {
  readonly net: NetParams;
  readonly datasetEpisodes: number;
  readonly epochs: number;
  readonly lr: number;
  readonly l2?: number;
  /** enemyHpMult tiers cycled across episodes for outcome variance. Default [1]. */
  readonly difficulties?: readonly number[];
  readonly onEpoch?: (epoch: number, stats: TrainStats, samples: number) => void;
}

/** Generate a diversified MCTS-expert dataset and supervised-train the net. Mutates net. */
export function pretrainFromMcts(opts: PretrainOptions): NetParams {
  const difficulties = opts.difficulties?.length ? opts.difficulties : [1];
  const data: TrainSample[] = [];
  for (let e = 0; e < opts.datasetEpisodes; e++) {
    const enemyHpMult = difficulties[e % difficulties.length] ?? 1;
    const config: RunConfig = { ...opts.config, enemyHpMult };
    data.push(...mctsExpertEpisode(`mcts-expert-${e}`, { ...opts, config }));
  }
  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const stats = trainStep(opts.net, data, opts.lr, opts.l2 ?? 0);
    opts.onEpoch?.(epoch, stats, data.length);
  }
  return opts.net;
}
