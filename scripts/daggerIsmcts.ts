/**
 * DAgger-imitate-ISMCTS for hard difficulty. ISMCTS is a strong, LEARNABLE expert
 * (fog-of-war search, function of observable state). Each step: run ISMCTS for the
 * (soft visit) policy target + root value; play beta-mixed (ISMCTS / net) so later
 * rounds add the net's own states. Trains across base+hard so the net stays strong
 * at base while gaining hard competence (and hard PRIORS for hybrid search).
 *
 *   npx tsx scripts/daggerIsmcts.ts --rounds=5 --statesPerRound=120 --ismctsIters=60 \
 *     --epochs=120 --difficulties=1.0,1.5 --evalRuns=30 --out=.models/dagger_ismcts.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE, actionMask, slotOf } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, createNet, trainStep } from '../src/search/net.js';
import { ismctsSearch } from '../src/search/ismcts.js';
import { policyAction, policyWinRate } from '../src/search/policy.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '5'));
const STATES_PER_ROUND = Number(arg('statesPerRound', '120'));
const ISMCTS_ITERS = Number(arg('ismctsIters', '60'));
const EPOCHS = Number(arg('epochs', '120'));
const BETA0 = Number(arg('beta0', '0.7'));
const BETA_DECAY = Number(arg('betaDecay', '0.6'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const OUT = arg('out', '.models/dagger_ismcts.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5').split(',').map(Number).filter((n) => n > 0);

const enc = createEncoder(content, undefined, { positionalHand: false });
const initRng = new Rng(seedFromString('di-init'));
const net: NetParams = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
const searchRng = (() => { const r = new Rng(seedFromString('di-search')); return () => r.next(); })();
const mixRng = (() => { const r = new Rng(seedFromString('di-mix')); return () => r.next(); })();
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

const D: TrainSample[] = [];

for (let round = 0; round < ROUNDS; round++) {
  const beta = round === 0 ? 1 : BETA0 * BETA_DECAY ** (round - 1);
  let added = 0;
  let ep = 0;
  while (added < STATES_PER_ROUND) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[(round * 5 + ep) % DIFFICULTIES.length] ?? 1 };
    let s: RunState = createRun(content, `di-${round}-${ep}`, config);
    for (let i = 0; i < 6000 && s.phase !== 'victory' && s.phase !== 'defeat' && added < STATES_PER_ROUND; i++) {
      const res = ismctsSearch(content, s, { iterations: ISMCTS_ITERS, rand: searchRng });
      const { mask } = actionMask(content, s);
      // One-hot the ISMCTS argmax action — a crisp, learnable target (soft visit
      // distributions at low iteration counts are too diffuse to fit; cf. greedy clone).
      const slot = slotOf(s, res.action);
      if (slot !== null) {
        const pi = new Float32Array(ACTION_SPACE);
        pi[slot] = 1;
        D.push({ x: enc.encode(s), pi, mask, z: res.rootValue });
        added++;
      }
      const played: GameAction = mixRng() < beta ? res.action : policyAction(content, s, enc, net);
      s = applyAction(content, s, played);
    }
    ep++;
  }

  let loss = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) loss = trainStep(net, D, LR, L2).loss;

  const wrBase = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, evalSeeds);
  const wrHard = policyWinRate(content, enc, net, { ...DEFAULT_RUN_CONFIG, enemyHpMult: 1.5 }, evalSeeds);
  console.log(
    `round ${round}: beta=${beta.toFixed(2)} |D|=${D.length} loss=${loss.toFixed(4)} ` +
      `no-search base=${(wrBase * 100).toFixed(1)}% hp1.5=${(wrHard * 100).toFixed(1)}%`,
  );
}

saveCheckpoint(OUT, enc.manifest, net);
console.log(`saved -> ${OUT}`);
