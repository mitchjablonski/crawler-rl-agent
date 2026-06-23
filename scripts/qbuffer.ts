/**
 * Determinized counterfactual-Q offline experiment (both threads in one run):
 *   #2 sharper policy targets: softmax(Q/tau) vs argmax-Q one-hot.
 *   #1 amortize search: put the (learnable) determinized-Q value head into net-PUCT.
 *
 *   npx tsx scripts/qbuffer.ts --states=300 --k=24 --epochs=250 --tau=0.15 \
 *     --puctIters=160,400 --evalRuns=30 --out=.models/qnet.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, createNet, trainStep } from '../src/search/net.js';
import { greedyAction } from '../src/search/heuristic.js';
import { buildQTargets } from '../src/search/determinized.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';
import { policyWinRate } from '../src/search/policy.js';
import { evaluateWinRate } from '../src/search/train.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const STATES = Number(arg('states', '300'));
const K = Number(arg('k', '24'));
const EPOCHS = Number(arg('epochs', '250'));
const TAU = Number(arg('tau', '0.15'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const PUCT_ITERS = arg('puctIters', '160,400').split(',').map(Number);
const OUT = arg('out', '.models/qnet.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);

const enc = createEncoder(content, undefined, { positionalHand: false });
const genRng = (() => { const r = new Rng(seedFromString('q-gen')); return () => r.next(); })();
const qRng = (() => { const r = new Rng(seedFromString('q-roll')); return () => r.next(); })();

// Collect states across difficulties via greedy play.
const states: RunState[] = [];
let ep = 0;
while (states.length < STATES) {
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[ep % DIFFICULTIES.length] ?? 1 };
  let s: RunState = createRun(content, `q-state-${ep}`, config);
  for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat' && states.length < STATES; i++) {
    states.push(s);
    s = applyAction(content, s, greedyAction(s, content, genRng));
  }
  ep++;
}
console.log(`collected ${states.length} states; computing Q_det (k=${K})...`);

// Compute determinized Q once per state.
interface QRow { x: Float32Array; mask: Float32Array; q: Float32Array; value: number; }
const rows: QRow[] = [];
for (const s of states) {
  const { mask, q, value } = buildQTargets(content, s, K, qRng, TAU);
  let any = false;
  for (let i = 0; i < ACTION_SPACE; i++) if ((mask[i] ?? 0) > 0) any = true;
  if (any) rows.push({ x: enc.encode(s), mask, q, value });
}
const meanV = rows.reduce((a, r) => a + r.value, 0) / Math.max(1, rows.length);
console.log(`${rows.length} samples; mean target value=${meanV.toFixed(3)}`);

function softmaxPi(q: Float32Array, mask: Float32Array): Float32Array {
  const pi = new Float32Array(ACTION_SPACE);
  let mx = -Infinity;
  for (let i = 0; i < ACTION_SPACE; i++) if ((mask[i] ?? 0) > 0 && (q[i] ?? 0) > mx) mx = q[i] ?? 0;
  let sum = 0;
  for (let i = 0; i < ACTION_SPACE; i++) if ((mask[i] ?? 0) > 0) { const e = Math.exp(((q[i] ?? 0) - mx) / TAU); pi[i] = e; sum += e; }
  if (sum > 0) for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (pi[i] ?? 0) / sum;
  return pi;
}
function argmaxPi(q: Float32Array, mask: Float32Array): Float32Array {
  const pi = new Float32Array(ACTION_SPACE);
  let best = -1, mx = -Infinity;
  for (let i = 0; i < ACTION_SPACE; i++) if ((mask[i] ?? 0) > 0 && (q[i] ?? 0) > mx) { mx = q[i] ?? 0; best = i; }
  if (best >= 0) pi[best] = 1;
  return pi;
}

function train(targetMode: 'softmax' | 'argmax'): NetParams {
  const data: TrainSample[] = rows.map((r) => ({
    x: r.x,
    pi: targetMode === 'softmax' ? softmaxPi(r.q, r.mask) : argmaxPi(r.q, r.mask),
    mask: r.mask,
    z: r.value,
  }));
  const initRng = new Rng(seedFromString(`q-init-${targetMode}`));
  const net = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
  let last = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) last = trainStep(net, data, LR, L2).policyLoss;
  console.log(`  [${targetMode}] final policyLoss=${last.toFixed(4)}`);
  return net;
}

const seeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

console.log('\n=== #2 sharper policy targets (no-search win rate) ===');
const softNet = train('softmax');
const argNet = train('argmax');
console.log(`softmax(Q/tau=${TAU}): ${(policyWinRate(content, enc, softNet, DEFAULT_RUN_CONFIG, seeds) * 100).toFixed(1)}%`);
console.log(`argmax-Q one-hot:     ${(policyWinRate(content, enc, argNet, DEFAULT_RUN_CONFIG, seeds) * 100).toFixed(1)}%  (cloning baseline ~12%)`);

console.log('\n=== #1 determinized-Q value head inside net-PUCT ===');
for (const iters of PUCT_ITERS) {
  const r = (() => { const rng = new Rng(seedFromString('q-puct')); return () => rng.next(); })();
  const wr = evaluateWinRate({ content, encoder: enc, net: softNet, config: DEFAULT_RUN_CONFIG, searchIterations: iters, rand: r }, seeds);
  console.log(`net-PUCT iters=${iters}: ${(wr * 100).toFixed(1)}%  (self-play net was ~85% @400)`);
}

saveCheckpoint(OUT, enc.manifest, softNet);
console.log(`\nsaved -> ${OUT}`);
