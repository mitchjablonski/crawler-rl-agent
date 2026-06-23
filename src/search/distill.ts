import type { NetParams, TrainSample, TrainStats } from './net.js';
import { trainStep } from './net.js';
import { type SelfPlayOptions, selfPlayEpisode } from './train.js';

export interface DistillOptions {
  /** Teacher self-play config (trained net + PUCT) used to GENERATE the targets. */
  readonly teacher: SelfPlayOptions;
  /** Student net to fit (mutated in place). */
  readonly student: NetParams;
  readonly datasetEpisodes: number;
  readonly epochs: number;
  readonly lr: number;
  readonly l2?: number;
  readonly onEpoch?: (epoch: number, stats: TrainStats, samples: number) => void;
}

/**
 * Collect a dataset of (state, π, z) by self-playing the teacher with PUCT, then
 * supervised-fit the student to imitate it. Returns the trained student.
 */
export function distill(opts: DistillOptions): NetParams {
  const data: TrainSample[] = [];
  for (let e = 0; e < opts.datasetEpisodes; e++) {
    data.push(...selfPlayEpisode(`distill-${e}`, opts.teacher));
  }
  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const stats = trainStep(opts.student, data, opts.lr, opts.l2 ?? 0);
    opts.onEpoch?.(epoch, stats, data.length);
  }
  return opts.student;
}
