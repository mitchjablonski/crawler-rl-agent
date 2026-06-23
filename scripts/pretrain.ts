/**
 * Pre-train the net by imitating the clairvoyant MCTS expert with AlphaZero-style
 * data generation (soft visit-distribution targets, temperature sampling, graded
 * value target, difficulty diversity), then check the value head is non-degenerate
 * and evaluate net-PUCT.
 *
 *   npx tsx scripts/pretrain.ts --positional=false --episodes=60 --mctsIters=200 \
 *     --epochs=300 --difficulties=1.0,1.5,2.0 --temperature=1 --valueMode=blend \
 *     --evalIters=160,400 --evalRuns=20 --out=.models/pretrained.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, createNet, forward } from '../src/search/net.js';
import { greedyAction } from '../src/search/heuristic.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';
import { type ValueTargetMode, pretrainFromMcts } from '../src/search/pretrain.js';
import { evaluateWinRate } from '../src/search/train.js';
import { policyWinRate } from '../src/search/policy.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const EPISODES = Number(arg('episodes', '60'));
const MCTS_ITERS = Number(arg('mctsIters', '200'));
const EPOCHS = Number(arg('epochs', '300'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const TEMPERATURE = Number(arg('temperature', '1'));
const TEMP_MOVES = Number(arg('tempMoves', '8'));
const VALUE_MODE = arg('valueMode', 'blend') as ValueTargetMode;
const VALUE_BLEND = Number(arg('valueBlend', '0.5'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0')
  .split(',')
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n) && n > 0);
const EVAL_ITERS = arg('evalIters', '160,400')
  .split(',')
  .map((s) => Number(s));
const EVAL_RUNS = Number(arg('evalRuns', '20'));
const OUT = arg('out', '.models/pretrained.json');
const POSITIONAL = arg('positional', 'true') !== 'false';

const encoder = createEncoder(content, undefined, { positionalHand: POSITIONAL });
const initRng = new Rng(seedFromString('pretrain-init'));
const net: NetParams = createNet(
  { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
  () => initRng.next(),
);
const expertRng = (() => {
  const r = new Rng(seedFromString('pretrain-expert'));
  return () => r.next();
})();

console.log(
  `pretrain: episodes=${EPISODES} mctsIters=${MCTS_ITERS} epochs=${EPOCHS} ` +
    `difficulties=[${DIFFICULTIES.join(',')}] temp=${TEMPERATURE} valueMode=${VALUE_MODE} ` +
    `| encoder=${encoder.size} fp=${encoder.fingerprint}`,
);

pretrainFromMcts({
  content,
  encoder,
  config: DEFAULT_RUN_CONFIG,
  iterations: MCTS_ITERS,
  rand: expertRng,
  temperature: TEMPERATURE,
  temperatureMoves: TEMP_MOVES,
  valueTargetMode: VALUE_MODE,
  valueBlend: VALUE_BLEND,
  difficulties: DIFFICULTIES,
  net,
  datasetEpisodes: EPISODES,
  epochs: EPOCHS,
  lr: LR,
  l2: L2,
  onEpoch: (e, stats, n) => {
    if (e % 25 === 0 || e === EPOCHS - 1) {
      console.log(
        `  epoch ${e}: loss=${stats.loss.toFixed(4)} ` +
          `(p=${stats.policyLoss.toFixed(4)} v=${stats.valueLoss.toFixed(4)}) samples=${n}`,
      );
    }
  },
});

// Guardrail: the value head must discriminate states, not collapse to a constant.
const spreadRng = (() => {
  const r = new Rng(seedFromString('pretrain-spread'));
  return () => r.next();
})();
const vals: number[] = [];
for (let i = 0; i < 8; i++) {
  let s: RunState = createRun(content, `eval-${i}`, DEFAULT_RUN_CONFIG);
  for (let k = 0; k < 200 && s.phase !== 'victory' && s.phase !== 'defeat'; k++) {
    vals.push(forward(net, encoder.encode(s)).value);
    s = applyAction(content, s, greedyAction(s, content, spreadRng));
  }
}
const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length));
console.log(`value-head spread: std=${std.toFixed(4)} mean=${mean.toFixed(3)} (collapse if std~0)`);

const seeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);
console.log(`pretrained no-search policy: ${(policyWinRate(content, encoder, net, DEFAULT_RUN_CONFIG, seeds) * 100).toFixed(1)}%`);
for (const iters of EVAL_ITERS) {
  const r = (() => {
    const rng = new Rng(seedFromString('pretrain-eval'));
    return () => rng.next();
  })();
  const wr = evaluateWinRate(
    { content, encoder, net, config: DEFAULT_RUN_CONFIG, searchIterations: iters, rand: r },
    seeds,
  );
  console.log(`pretrained net-PUCT iters=${iters}: ${(wr * 100).toFixed(1)}%`);
}

saveCheckpoint(OUT, encoder.manifest, net);
console.log(`saved pretrained net -> ${OUT} (fingerprint ${encoder.fingerprint})`);
