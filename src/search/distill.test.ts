import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { createEncoder } from './encode.js';
import { ACTION_SPACE } from './mask.js';
import { DEFAULT_HIDDEN, createNet } from './net.js';
import type { SelfPlayOptions } from './train.js';
import { distill } from './distill.js';

function rand(seed: string): () => number {
  const r = new Rng(seedFromString(seed));
  return () => r.next();
}

const enc = createEncoder(content);

describe('distill', () => {
  it('fits a student to the teacher and reduces policy loss over epochs', () => {
    const teacher: SelfPlayOptions = {
      content,
      encoder: enc,
      net: createNet(
        { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: DEFAULT_HIDDEN },
        rand('teacher'),
      ),
      config: DEFAULT_RUN_CONFIG,
      searchIterations: 8,
      rand: rand('search'),
    };
    const student = createNet(
      { inputSize: enc.size, actionSize: ACTION_SPACE, hidden: 64 },
      rand('student'),
    );

    const losses: number[] = [];
    distill({
      teacher,
      student,
      datasetEpisodes: 2,
      epochs: 15,
      lr: 0.05,
      onEpoch: (_e, stats) => losses.push(stats.policyLoss),
    });

    expect(losses.length).toBe(15);
    expect(losses[losses.length - 1]).toBeLessThan(losses[0]!);
    for (const w of student.wPolicy) expect(Number.isFinite(w)).toBe(true);
  });
});
