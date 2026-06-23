/**
 * AlphaZero-lite training runner (dev tool).
 *
 *   npx tsx scripts/train.ts --rounds=50 --episodes=8 --iters=32 --lr=0.02 --out=.models/az.json
 *
 * Self-plays PUCT episodes, trains the policy/value net on the visit
 * distributions + outcomes, and periodically reports held-out win rate.
 * The saved checkpoint bundles the vocab manifest + fingerprint so the exact
 * encoding it was trained with travels with the weights.
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, createNet, type NetParams } from '../src/search/net.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';
import { evaluateWinRate, trainLoop } from '../src/search/train.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '30'));
const EPISODES = Number(arg('episodes', '8'));
const ITERS = Number(arg('iters', '32'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_EVERY = Number(arg('evalEvery', '5'));
const EVAL_RUNS = Number(arg('evalRuns', '20'));
const OUT = arg('out', '.models/alphazero.json');
const SEED = arg('seed', 'az');
const POSITIONAL = arg('positional', 'true') !== 'false';
// Difficulty curriculum: comma-separated enemyHpMult tiers cycled per round.
const CURRICULUM = arg('curriculum', '')
  .split(',')
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n) && n > 0);

const config: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  maxHp: Number(arg('maxhp', String(DEFAULT_RUN_CONFIG.maxHp))),
  startingGold: Number(arg('gold', String(DEFAULT_RUN_CONFIG.startingGold))),
};

const curriculum =
  CURRICULUM.length > 0
    ? (round: number): RunConfig => ({
        ...config,
        enemyHpMult: CURRICULUM[round % CURRICULUM.length] ?? 1,
      })
    : undefined;

const encoder = createEncoder(content, undefined, { positionalHand: POSITIONAL });
// One Rng instance reused across all weights — a fresh Rng per call would return
// the same first value every time, collapsing the hidden layer (no symmetry break).
const initRng = new Rng(seedFromString(`${SEED}-init`));
const net: NetParams = createNet(
  { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
  () => initRng.next(),
);

// Disjoint held-out eval seeds (never used for training).
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);
const rand = (() => {
  const r = new Rng(seedFromString(`${SEED}-search`));
  return () => r.next();
})();

const base = {
  content,
  encoder,
  net,
  config,
  searchIterations: ITERS,
  rand,
};

console.log(
  `training: rounds=${ROUNDS} episodes=${EPISODES} iters=${ITERS} lr=${LR} ` +
    `hidden=${HIDDEN} curriculum=[${CURRICULUM.join(',') || 'none'}] | ` +
    `encoder=${encoder.size} actions=${ACTION_SPACE} fp=${encoder.fingerprint}`,
);

let round = 0;
while (round < ROUNDS) {
  const chunk = Math.min(EVAL_EVERY, ROUNDS - round);
  trainLoop({
    ...base,
    rounds: chunk,
    episodesPerRound: EPISODES,
    lr: LR,
    l2: L2,
    curriculum: curriculum ? (r) => curriculum(round + r) : undefined,
    onRound: (r, info) =>
      console.log(
        `  round ${round + r} [hpMult=${(info.config.enemyHpMult ?? 1).toFixed(2)}]: ` +
          `loss=${info.stats.loss.toFixed(4)} ` +
          `(p=${info.stats.policyLoss.toFixed(4)} v=${info.stats.valueLoss.toFixed(4)}) ` +
          `selfplayWins=${info.wins}/${info.episodes} samples=${info.samples}`,
      ),
  });
  round += chunk;
  // Eval at baseline (1.0) plus each curriculum tier so we see robustness.
  const baseWr = evaluateWinRate(base, evalSeeds);
  const tiers = CURRICULUM.filter((m) => m !== 1);
  const tierWr = tiers.map((m) => {
    const wr = evaluateWinRate({ ...base, config: { ...config, enemyHpMult: m } }, evalSeeds);
    return `hp${m}=${(wr * 100).toFixed(0)}%`;
  });
  console.log(
    `== after ${round} rounds: held-out win rate base=${(baseWr * 100).toFixed(1)}% ` +
      `${tierWr.join(' ')} ==`,
  );
}

saveCheckpoint(OUT, encoder.manifest, net);
console.log(`saved checkpoint -> ${OUT} (fingerprint ${encoder.fingerprint})`);
