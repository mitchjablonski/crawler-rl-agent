/**
 * Train + VERIFY a SEPARATE value network — the fix the calibration investigation pointed to
 * (docs/value-head-calibration.md). The shared-trunk value head collapsed to a near-constant ~50%;
 * a standalone value MLP (its own trunk) on a threat-aware encoder, trained on honest realized
 * outcomes, should instead DISCRIMINATE easy from brutal. We train it and print the calibration to
 * prove it (or not).
 *
 * Targets are realizedWin (greedy MC over re-seeded futures) — an UNBIASED estimate of the win
 * probability (though noisy at finite reseeds); the question is whether a separate net can LEARN to
 * track it where the shared head could not.
 *
 *   npx tsx scripts/train-value.ts --states=800 --val=400 --reseeds=15 --epochs=300
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';
import { greedyPlayer } from '../src/search/balance.js';
import { sampleStates } from '../src/search/equity.js';
import { realizedWin, binCalibration } from '../src/search/calibration.js';
import { type ValueSample, cloneValueNet, createValueNet, valueForward, valueTrainStep } from '../src/search/valueNet.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const N_TRAIN = Number(arg('states', '800'));
const N_VAL = Number(arg('val', '400'));
const RESEEDS = Number(arg('reseeds', '15'));
const EPOCHS = Number(arg('epochs', '300'));
const HIDDEN = Number(arg('hidden', '128'));
const LR = Number(arg('lr', '0.05'));
const L2 = Number(arg('l2', '0.0001'));
const STRIDE = Number(arg('stride', '5'));
const OUT = arg('out', '.models/value.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1').split(',').map(Number).filter((n) => n >= 1);

const enc = createEncoder(content, undefined, { positionalHand: false, absoluteThreat: true });
console.log(`encoder: obs=${enc.size} absoluteThreat=true`);
const rng = (() => { const r = new Rng(seedFromString('vtrain')); return () => r.next(); })();

function specs(tag: string, count: number): Array<{ seed: string; config: RunConfig }> {
  return Array.from({ length: count }, (_, i) => {
    const d = DIFFICULTIES[i % DIFFICULTIES.length] ?? 1;
    const acts = ARCS[Math.floor(i / DIFFICULTIES.length) % ARCS.length] ?? 1;
    return { seed: `${tag}-${i}`, config: { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts } };
  });
}

// --- collect (state, realized-win) training data ---
console.log(`sampling ${N_TRAIN} train states + computing realized win (${RESEEDS} reseeds each)...`);
const trainStates = sampleStates(content, greedyPlayer(rng), specs('vt', 600), STRIDE, N_TRAIN);
const data: ValueSample[] = trainStates.map((s) => ({ x: enc.encode(s), target: realizedWin(content, s, RESEEDS, rng) }));

// --- train (mini-batch SGD), keeping the best-by-train-loss snapshot ---
let net = createValueNet({ inputSize: enc.size, hidden: HIDDEN }, rng);
const BATCH = 64;
let bestLoss = Infinity;
let best = cloneValueNet(net);
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  let loss = 0;
  let nb = 0;
  for (let i = 0; i < data.length; i += BATCH) {
    loss += valueTrainStep(net, data.slice(i, i + BATCH), LR, L2).loss;
    nb++;
  }
  loss /= Math.max(1, nb);
  if (loss < bestLoss) { bestLoss = loss; best = cloneValueNet(net); }
  if (epoch % 50 === 0 || epoch === EPOCHS - 1) console.log(`  epoch ${epoch}: train MSE=${loss.toFixed(4)}`);
}
net = best;

// --- VERIFY: calibrate on DISJOINT val states (overall + per difficulty) ---
function calOn(diffs: readonly number[], count: number): { mean: number; real: number; over: number; ece: number } {
  const states = sampleStates(content, greedyPlayer(rng), specs('vv', 300).map((sp, i) => ({
    seed: `vv-${i}`, config: { ...sp.config, enemyHpMult: diffs[i % diffs.length] ?? 1 },
  })), STRIDE, count);
  const preds = states.map((s) => valueForward(net, enc.encode(s)));
  const real = states.map((s) => realizedWin(content, s, RESEEDS, rng));
  const c = binCalibration(preds, real, 10);
  return { mean: c.meanPred, real: c.meanReal, over: c.overconfidence, ece: c.ece };
}
console.log('\n=== SEPARATE VALUE NET calibration (disjoint val states) ===');
for (const [label, diffs] of [['overall', DIFFICULTIES], ['1.0x', [1.0]], ['2.0x', [2.0]]] as const) {
  const c = calOn(diffs, label === 'overall' ? N_VAL : Math.round(N_VAL / 2));
  console.log(
    `  ${label.padEnd(7)} meanPred=${(c.mean * 100).toFixed(1)}%  realized=${(c.real * 100).toFixed(1)}%  ` +
      `overconf=${(c.over * 100).toFixed(1)}  ECE=${(c.ece * 100).toFixed(1)}`,
  );
}
saveCheckpoint(OUT, enc.manifest, net);
console.log(`\nsaved -> ${OUT}`);
