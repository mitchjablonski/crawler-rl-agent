import { describe, expect, it } from 'vitest';
import { content } from '../engine/content/index.js';
import { legalActions } from './legalActions.js';
import { CrawlerEnv } from './env.js';

describe('CrawlerEnv', () => {
  it('reset returns an obs + legal mask of the right shapes', () => {
    const env = new CrawlerEnv(content);
    const { obs, mask, actions } = env.reset('env-1');
    expect(obs.length).toBe(env.observationSize);
    expect(mask.length).toBe(env.actionSpace);
    let legal = 0;
    for (let i = 0; i < env.actionSpace; i++) {
      if ((mask[i] ?? 0) > 0) {
        legal++;
        expect(actions[i]).not.toBeNull();
      }
    }
    expect(legal).toBe(legalActions(content, env.runState!).length);
  });

  it('runs a full episode to done with a terminal reward', () => {
    const env = new CrawlerEnv(content, { winReward: 1, lossReward: -1 });
    env.reset('env-2');
    let steps = 0;
    let last = { reward: 0, done: false, info: { phase: '' } as { phase: string; won?: boolean } };
    for (let i = 0; i < 6000; i++) {
      const legal = legalActions(content, env.runState!);
      const r = env.step(legal[0]!);
      steps++;
      last = r;
      if (r.done) break;
    }
    expect(steps).toBeGreaterThan(0);
    expect(last.done).toBe(true);
    expect(['victory', 'defeat']).toContain(last.info.phase);
    expect(Math.abs(last.reward)).toBeGreaterThan(0); // terminal win/loss reward fired
  });

  it('penalizes an illegal action without advancing', () => {
    const env = new CrawlerEnv(content);
    env.reset('env-3');
    const before = env.runState;
    const r = env.step({ type: 'rest' }); // illegal in the map phase
    expect(r.info.illegal).toBe(true);
    expect(r.reward).toBeLessThan(0);
    expect(env.runState).toBe(before); // no-op
  });
});
