import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { createRun } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import type { RunState } from '../engine/types.js';
import { applyAction } from '../engine/run.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE } from './mask.js';
import { DEFAULT_HIDDEN, createNet, forward } from './net.js';
import { greedyAction } from './heuristic.js';
import { type MctsExpertOptions, mctsExpertEpisode, pretrainFromMcts } from './pretrain.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);

function expertOpts(seed: string): MctsExpertOptions {
  return {
    content,
    encoder: enc,
    config: DEFAULT_RUN_CONFIG,
    iterations: 24,
    rand: rand(seed),
  };
}

/** Std of the net's value predictions across a sample of greedy-trajectory states. */
function valueSpread(net: Parameters<typeof forward>[0], seeds: string[]): number {
  const r = rand('spread');
  const vals: number[] = [];
  for (const seed of seeds) {
    let s: RunState = createRun(content, seed, DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 200 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      vals.push(forward(net, enc.encode(s)).value);
      s = applyAction(content, s, greedyAction(s, content, r));
    }
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

describe('mcts-expert pretraining', () => {
  it('records a soft visit-distribution policy target on legal slots', () => {
    const samples = mctsExpertEpisode('ep-1', expertOpts('a'));
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(s.x.length).toBe(enc.size);
      expect(s.z).toBeGreaterThanOrEqual(0);
      expect(s.z).toBeLessThanOrEqual(1);
      let piSum = 0;
      for (let i = 0; i < ACTION_SPACE; i++) {
        piSum += s.pi[i] ?? 0;
        if ((s.pi[i] ?? 0) > 0) expect(s.mask[i]).toBe(1);
      }
      expect(piSum).toBeCloseTo(1, 5);
    }
  });

  it('produces a non-degenerate value head (spread > 0) after pretraining', () => {
    const net = createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
      rand('net'),
    );
    const losses: number[] = [];
    pretrainFromMcts({
      ...expertOpts('b'),
      net,
      datasetEpisodes: 3,
      epochs: 40,
      lr: 0.05,
      difficulties: [1.0, 2.0], // mix in a hard tier for outcome variance
      onEpoch: (_e, stats) => losses.push(stats.loss),
    });
    expect(losses[losses.length - 1]).toBeLessThan(losses[0]!);
    // The graded value target must teach the head to discriminate, not collapse.
    expect(valueSpread(net, ['eval-0', 'eval-1', 'eval-2'])).toBeGreaterThan(0.02);
  });
});
