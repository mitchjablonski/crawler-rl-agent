/**
 * DAgger (Dataset Aggregation) with determinized-Q labels — the on-policy fix for
 * the offline distribution-shift cascade.
 *
 * Each round: roll out the CURRENT net (beta-mixed with greedy so early rounds
 * aren't garbage), collect the states it ACTUALLY visits, label each with
 * determinized-Q (the learnable expert target), aggregate into the buffer, and
 * retrain. The net converges on its own state distribution.
 *
 * Optional --treeIters>0 also harvests MCTS-tree states for extra breadth.
 *
 *   npx tsx scripts/dagger.ts --rounds=5 --statesPerRound=120 --k=12 --epochs=120 \
 *     --tau=0.2 --beta0=0.5 --betaDecay=0.5 --evalRuns=30 --out=.models/dagger.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE, actionMask, slotOf } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, createNet, trainStep } from '../src/search/net.js';
import { greedyAction } from '../src/search/heuristic.js';
import { policyAction, policyWinRate } from '../src/search/policy.js';
import { buildQTargets, qDeterminized } from '../src/search/determinized.js';
import { mctsExpertSearch } from '../src/search/mctsExpert.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '5'));
const STATES_PER_ROUND = Number(arg('statesPerRound', '120'));
const K = Number(arg('k', '12'));
const EPOCHS = Number(arg('epochs', '120'));
const TAU = Number(arg('tau', '0.2'));
const BETA0 = Number(arg('beta0', '0.5'));
const BETA_DECAY = Number(arg('betaDecay', '0.5'));
const TREE_ITERS = Number(arg('treeIters', '0'));
const LABEL = arg('label', 'q'); // 'q' = determinized-Q targets, 'greedy' = imitate greedy (cheap)
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const OUT = arg('out', '.models/dagger.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);

const enc = createEncoder(content, undefined, { positionalHand: false });
const initRng = new Rng(seedFromString('dag-init'));
const net: NetParams = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
const collectRng = (() => { const r = new Rng(seedFromString('dag-collect')); return () => r.next(); })();
const qRng = (() => { const r = new Rng(seedFromString('dag-q')); return () => r.next(); })();
const treeRng = (() => { const r = new Rng(seedFromString('dag-tree')); return () => r.next(); })();
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

const D: TrainSample[] = [];

for (let round = 0; round < ROUNDS; round++) {
  const beta = round === 0 ? 1 : BETA0 * BETA_DECAY ** (round - 1); // round 0 = pure greedy bootstrap

  // Collect states under the beta-mixed (greedy / net) policy.
  const collected: RunState[] = [];
  let ep = 0;
  while (collected.length < STATES_PER_ROUND) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[(round * 7 + ep) % DIFFICULTIES.length] ?? 1 };
    let s: RunState = createRun(content, `dag-${round}-${ep}`, config);
    for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat' && collected.length < STATES_PER_ROUND; i++) {
      collected.push(s);
      if (TREE_ITERS > 0) {
        const ts: RunState[] = [];
        mctsExpertSearch(content, s, { iterations: TREE_ITERS, rand: treeRng, collectStates: ts });
        for (let t = 0; t < 2 && collected.length < STATES_PER_ROUND; t++) {
          const pick = ts[Math.floor(treeRng() * ts.length)];
          if (pick) collected.push(pick);
        }
      }
      const a = collectRng() < beta ? greedyAction(s, content, collectRng) : policyAction(content, s, enc, net);
      s = applyAction(content, s, a);
    }
    ep++;
  }

  // Label the visited states (the learnable expert target) and aggregate.
  let added = 0;
  for (const s of collected) {
    if (LABEL === 'greedy') {
      // Imitate greedy's action (one-hot) + value = expected win playing greedy on (cheap).
      const a = greedyAction(s, content, qRng);
      const slot = slotOf(s, a);
      if (slot === null) continue;
      const { mask } = actionMask(content, s);
      const pi = new Float32Array(ACTION_SPACE);
      pi[slot] = 1;
      D.push({ x: enc.encode(s), pi, mask, z: qDeterminized(content, s, a, K, qRng) });
      added++;
    } else {
      const { mask, pi, value } = buildQTargets(content, s, K, qRng, TAU);
      let any = false;
      for (let i = 0; i < ACTION_SPACE; i++) if ((pi[i] ?? 0) > 0) any = true;
      if (any) {
        D.push({ x: enc.encode(s), pi, mask, z: value });
        added++;
      }
    }
  }

  // Retrain on the full aggregated buffer.
  let loss = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) loss = trainStep(net, D, LR, L2).loss;

  const wr = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, evalSeeds);
  console.log(
    `round ${round}: beta=${beta.toFixed(2)} added=${added} |D|=${D.length} loss=${loss.toFixed(4)} ` +
      `no-search=${(wr * 100).toFixed(1)}%`,
  );
}

saveCheckpoint(OUT, enc.manifest, net);
console.log(`saved -> ${OUT}  (DAgger no-search; cloning/offline baseline was ~0-13%)`);
