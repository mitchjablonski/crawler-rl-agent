import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import { type SelfPlayOptions, evaluateWinRate, selfPlayEpisode, trainLoop } from './train.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);

function makeOpts(seed: string): SelfPlayOptions {
  return {
    content,
    encoder: enc,
    net: createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
      rand('net'),
    ),
    config: DEFAULT_RUN_CONFIG,
    searchIterations: 8,
    rand: rand(seed),
  };
}

describe('train', () => {
  it('selfPlayEpisode yields well-formed samples', () => {
    const opts = makeOpts('sp');
    const samples = selfPlayEpisode('ep-1', opts);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(s.x.length).toBe(enc.size);
      expect(s.pi.length).toBe(ACTION_SPACE);
      expect([0, 1]).toContain(s.z);
      let piSum = 0;
      for (let i = 0; i < ACTION_SPACE; i++) {
        piSum += s.pi[i] ?? 0;
        if ((s.pi[i] ?? 0) > 0) expect(s.mask[i]).toBe(1); // π only on legal slots
      }
      expect(piSum).toBeCloseTo(1, 5);
    }
  });

  it('trainLoop runs rounds and reports finite loss; weights stay finite', () => {
    const opts = makeOpts('tl');
    const losses: number[] = [];
    const net = trainLoop({
      ...opts,
      rounds: 2,
      episodesPerRound: 2,
      lr: 0.05,
      onRound: (_r, info) => losses.push(info.stats.loss),
    });
    expect(losses.length).toBe(2);
    for (const l of losses) expect(Number.isFinite(l)).toBe(true);
    for (const w of net.w1) expect(Number.isFinite(w)).toBe(true);
  });

  it('evaluateWinRate returns a fraction in [0,1]', () => {
    const wr = evaluateWinRate(makeOpts('ev'), ['eval-0', 'eval-1']);
    expect(wr).toBeGreaterThanOrEqual(0);
    expect(wr).toBeLessThanOrEqual(1);
  });
});
