import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import type { ContentRegistry, RunState } from '../engine/types.js';
import type { Encoder } from './encode.js';
import { ACTION_SPACE, actionMask } from './mask.js';
import { type NetParams, type TrainSample, type TrainStats, trainStep } from './net.js';
import { puctAction, puctSearch } from './puct.js';

export interface SelfPlayOptions {
  readonly content: ContentRegistry;
  readonly encoder: Encoder;
  readonly net: NetParams;
  readonly config: RunConfig;
  readonly searchIterations: number;
  readonly rand: () => number;
  readonly maxSteps?: number;
}

/** Play one episode with PUCT; return (state, π, mask, z) samples for training. */
export function selfPlayEpisode(seed: string, opts: SelfPlayOptions): TrainSample[] {
  const { content, encoder, net } = opts;
  let state: RunState = createRun(content, seed, opts.config);
  const pending: Array<Omit<TrainSample, 'z'>> = [];
  const cap = opts.maxSteps ?? 4000;
  for (let step = 0; step < cap && state.phase !== 'victory' && state.phase !== 'defeat'; step++) {
    const { action, visits } = puctSearch(content, state, {
      encoder,
      net,
      iterations: opts.searchIterations,
      rand: opts.rand,
    });
    const { mask } = actionMask(content, state);
    let total = 0;
    for (const vn of visits) total += vn;
    const pi = new Float32Array(ACTION_SPACE);
    if (total > 0) for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (visits[i] ?? 0) / total;
    pending.push({ x: encoder.encode(state), pi, mask });
    state = applyAction(content, state, action);
  }
  const z = state.phase === 'victory' ? 1 : 0;
  return pending.map((s) => ({ ...s, z }));
}

export interface TrainLoopOptions extends SelfPlayOptions {
  readonly rounds: number;
  readonly episodesPerRound: number;
  readonly lr: number;
  readonly l2?: number;
  /** Optional difficulty curriculum: returns the RunConfig to self-play at for a round. */
  readonly curriculum?: (round: number, rand: () => number) => RunConfig;
  readonly onRound?: (
    round: number,
    info: {
      stats: TrainStats;
      wins: number;
      episodes: number;
      samples: number;
      config: RunConfig;
    },
  ) => void;
}

/** Run rounds of self-play + SGD. Mutates opts.net in place; returns it. */
export function trainLoop(opts: TrainLoopOptions): NetParams {
  let counter = 0;
  for (let round = 0; round < opts.rounds; round++) {
    const config = opts.curriculum ? opts.curriculum(round, opts.rand) : opts.config;
    const spOpts: SelfPlayOptions = {
      content: opts.content,
      encoder: opts.encoder,
      net: opts.net,
      config,
      searchIterations: opts.searchIterations,
      rand: opts.rand,
      maxSteps: opts.maxSteps,
    };
    const batch: TrainSample[] = [];
    let wins = 0;
    for (let e = 0; e < opts.episodesPerRound; e++) {
      const samples = selfPlayEpisode(`train-${round}-${e}-${counter++}`, spOpts);
      batch.push(...samples);
      if (samples.length > 0 && samples[0]?.z === 1) wins++;
    }
    const stats = trainStep(opts.net, batch, opts.lr, opts.l2 ?? 0);
    opts.onRound?.(round, {
      stats,
      wins,
      episodes: opts.episodesPerRound,
      samples: batch.length,
      config,
    });
  }
  return opts.net;
}

/** Greedy-PUCT win rate over a (held-out) set of seeds. */
export function evaluateWinRate(opts: SelfPlayOptions, seeds: readonly string[]): number {
  if (seeds.length === 0) return 0;
  let wins = 0;
  const cap = opts.maxSteps ?? 4000;
  for (const seed of seeds) {
    let state: RunState = createRun(opts.content, seed, opts.config);
    for (let i = 0; i < cap && state.phase !== 'victory' && state.phase !== 'defeat'; i++) {
      const action = puctAction(opts.content, state, {
        encoder: opts.encoder,
        net: opts.net,
        iterations: opts.searchIterations,
        rand: opts.rand,
      });
      state = applyAction(opts.content, state, action);
    }
    if (state.phase === 'victory') wins++;
  }
  return wins / seeds.length;
}
