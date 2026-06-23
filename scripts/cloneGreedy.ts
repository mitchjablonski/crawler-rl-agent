/**
 * Direct behavioral cloning of the greedy heuristic — the clean test of whether
 * the net CAN learn competent reactive play. Greedy is a learnable, reactive,
 * non-clairvoyant expert (~60% on eval seeds), so its action is a function of the
 * observed state. Target = one-hot greedy action; value = the episode outcome.
 *
 *   npx tsx scripts/cloneGreedy.ts --states=2500 --epochs=250 --evalRuns=30
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE, actionMask, slotOf } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, createNet, trainStep } from '../src/search/net.js';
import { greedyAction } from '../src/search/heuristic.js';
import { policyWinRate } from '../src/search/policy.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const STATES = Number(arg('states', '2500'));
const EPOCHS = Number(arg('epochs', '250'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const OUT = arg('out', '.models/greedyclone.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);

const enc = createEncoder(content, undefined, { positionalHand: false });
const genRng = (() => { const r = new Rng(seedFromString('clone-gen')); return () => r.next(); })();

// Collect (state, greedy-action, mask) and the episode outcome.
interface Step { x: Float32Array; slot: number; mask: Float32Array; }
const data: TrainSample[] = [];
let ep = 0;
let collected = 0;
while (collected < STATES) {
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[ep % DIFFICULTIES.length] ?? 1 };
  let s: RunState = createRun(content, `clone-${ep}`, config);
  const steps: Step[] = [];
  for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
    const a: GameAction = greedyAction(s, content, genRng);
    const slot = slotOf(s, a);
    const { mask } = actionMask(content, s); // FULL legal set, so CE is over all options
    if (slot !== null) steps.push({ x: enc.encode(s), slot, mask });
    s = applyAction(content, s, a);
  }
  const z = s.phase === 'victory' ? 1 : 0;
  for (const st of steps) {
    const pi = new Float32Array(ACTION_SPACE);
    pi[st.slot] = 1;
    data.push({ x: st.x, pi, mask: st.mask, z });
    collected++;
  }
  ep++;
}
console.log(`cloned ${data.length} greedy decisions over ${ep} episodes`);

const initRng = new Rng(seedFromString('clone-init'));
const net: NetParams = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const stats = trainStep(net, data, LR, L2);
  if (epoch % 25 === 0 || epoch === EPOCHS - 1) {
    console.log(`  epoch ${epoch}: loss=${stats.loss.toFixed(4)} (p=${stats.policyLoss.toFixed(4)} v=${stats.valueLoss.toFixed(4)})`);
  }
}

const seeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);
const wr = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, seeds);
console.log(`\ngreedy-clone NO-SEARCH win rate: ${(wr * 100).toFixed(1)}%  (greedy itself ~60%, our other nets ~30%)`);
saveCheckpoint(OUT, enc.manifest, net);
