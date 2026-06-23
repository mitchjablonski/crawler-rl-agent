/**
 * Reference REINFORCE-with-baseline (tiny actor-critic) wired directly on CrawlerEnv —
 * shows the gym interface end-to-end: reset/step, masked-softmax sampling, Monte-Carlo
 * returns, advantage = return − V(s), policy-gradient + value update.
 *
 * NOTE: pure policy-gradient is sample-inefficient on a planning game (no search) — this
 * is a correct *reference*, not the strong agent. Search/DAgger get far higher win rates.
 *
 *   npx tsx scripts/reinforce.ts --iters=80 --batch=8 --gamma=0.99 --lr=0.05
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type RlSample, createNet, forward, policyPriors, reinforceStep } from '../src/search/net.js';
import { CrawlerEnv } from '../src/search/env.js';
import { policyWinRate } from '../src/search/policy.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const ITERS = Number(arg('iters', '80'));
const BATCH = Number(arg('batch', '8'));
const GAMMA = Number(arg('gamma', '0.99'));
const LR = Number(arg('lr', '0.05'));
const VALUE_COEF = Number(arg('valueCoef', '0.5'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_EVERY = Number(arg('evalEvery', '10'));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const DIFFICULTIES = arg('difficulties', '1.0').split(',').map(Number).filter((n) => n > 0);

const enc = createEncoder(content, undefined, { positionalHand: false });
const env = new CrawlerEnv(content, { encoder: enc, rewardShaping: true, gamma: GAMMA, winReward: 1, lossReward: 0 });
const initRng = new Rng(seedFromString('rl-init'));
const net: NetParams = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
const sampleRng = (() => { const r = new Rng(seedFromString('rl-sample')); return () => r.next(); })();
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

function sampleSlot(pri: Float32Array): number {
  let r = sampleRng();
  for (let i = 0; i < ACTION_SPACE; i++) {
    r -= pri[i] ?? 0;
    if (r <= 0 && (pri[i] ?? 0) > 0) return i;
  }
  for (let i = ACTION_SPACE - 1; i >= 0; i--) if ((pri[i] ?? 0) > 0) return i;
  return -1;
}

console.log(`REINFORCE on CrawlerEnv: obs=${env.observationSize} actions=${env.actionSpace} gamma=${GAMMA}`);

for (let iter = 0; iter < ITERS; iter++) {
  const raw: Array<{ x: Float32Array; mask: Float32Array; slot: number; ret: number }> = [];
  let wins = 0;
  for (let b = 0; b < BATCH; b++) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[(iter * BATCH + b) % DIFFICULTIES.length] ?? 1 };
    let { obs, mask } = env.reset(`rl-${iter}-${b}`, config);
    const traj: Array<{ x: Float32Array; mask: Float32Array; slot: number; reward: number }> = [];
    let done = false;
    for (let step = 0; step < 6000 && !done; step++) {
      const pri = policyPriors(forward(net, obs).policy, mask);
      const slot = sampleSlot(pri);
      if (slot < 0) break;
      const r = env.stepSlot(slot);
      traj.push({ x: obs, mask, slot, reward: r.reward });
      obs = r.obs;
      mask = r.mask;
      done = r.done;
      if (done && r.info.won) wins++;
    }
    let g = 0;
    for (let t = traj.length - 1; t >= 0; t--) {
      const tr = traj[t]!;
      g = tr.reward + GAMMA * g;
      raw.push({ x: tr.x, mask: tr.mask, slot: tr.slot, ret: g });
    }
  }

  // Advantage = return − V(s), normalized across the batch (variance reduction).
  const adv = raw.map((s) => s.ret - forward(net, s.x).value);
  const mean = adv.reduce((a, b) => a + b, 0) / Math.max(1, adv.length);
  const std = Math.sqrt(adv.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, adv.length)) + 1e-6;
  const batchSamples: RlSample[] = raw.map((s, i) => ({
    x: s.x, mask: s.mask, actionSlot: s.slot, ret: s.ret, advantage: ((adv[i] ?? 0) - mean) / std,
  }));
  const stats = reinforceStep(net, batchSamples, LR, VALUE_COEF);

  if (iter % EVAL_EVERY === 0 || iter === ITERS - 1) {
    const wr = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, evalSeeds);
    console.log(
      `iter ${iter}: trainWins=${wins}/${BATCH} valueLoss=${stats.valueLoss.toFixed(4)} ` +
        `greedy-eval=${(wr * 100).toFixed(1)}%`,
    );
  }
}
