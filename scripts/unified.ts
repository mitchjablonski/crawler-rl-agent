/**
 * Unified cross-difficulty net: DAgger with a difficulty-appropriate expert —
 * deterministic GREEDY at base (clones cleanly → strong base policy + priors) and
 * ISMCTS at hard (teaches good hard priors). One net trained on both, so it should
 * give base no-search ~70%, base hybrid ~100%, and hard hybrid ~83% together.
 *
 *   npx tsx scripts/unified.ts --rounds=5 --statesPerRound=160 --ismctsIters=80 \
 *     --epochs=140 --difficulties=1.0,1.5 --evalRuns=30 --out=.models/unified.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { CHARACTER_IDS, DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { classConfig } from '../src/search/balance.js';
import { ACTION_SPACE, actionMask, slotOf } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, cloneNet, createNet, trainStep } from '../src/search/net.js';
import { greedyAction } from '../src/search/heuristic.js';
import { ismctsSearch } from '../src/search/ismcts.js';
import { qDeterminized } from '../src/search/determinized.js';
import { policyAction, policyWinRate } from '../src/search/policy.js';
import { saveCheckpoint } from '../src/search/checkpoint.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '5'));
const STATES_PER_ROUND = Number(arg('statesPerRound', '160'));
const ISMCTS_ITERS = Number(arg('ismctsIters', '80'));
const K = Number(arg('k', '6'));
const EPOCHS = Number(arg('epochs', '140'));
const BETA0 = Number(arg('beta0', '0.6'));
const BETA_DECAY = Number(arg('betaDecay', '0.6'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const OUT = arg('out', '.models/unified.json');
const DIFFICULTIES = arg('difficulties', '1.0,1.5').split(',').map(Number).filter((n) => n > 0);
// Arc counts to train across (1 = single session, 3 = full multi-act arc). The encoder's
// act one-hot lets one net specialize per tier; DAgger samples the difficulty×arc grid.
const ARCS = arg('arcs', '1,3').split(',').map(Number).filter((n) => n >= 1);
// Classes to train across. One shared, class-conditioned net plays all of them (the encoder's
// class one-hot lets it specialize); DAgger samples the class × difficulty × arc grid.
const CLASSES = arg('classes', CHARACTER_IDS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
// Full Cartesian product of class × difficulty × arc, sampled as a SINGLE index. Picking the
// three axes with parallel moduli confounds them (when arrays share a length the axes lock in
// lockstep, e.g. class⊗arc) — one index into the product guarantees every combo is trained.
const GRID = CLASSES.flatMap((cls) => DIFFICULTIES.flatMap((d) => ARCS.map((acts) => ({ cls, d, acts }))));
// Encode concrete enemy intent (telegraphed damage/block/flags)? A/B flag for the encoder-
// sufficiency experiment: does richer combat info lift the no-search policy ceiling?
const INTENT = arg('intent', '0') === '1';

// Seed tag: suffixes every rng + the training trajectory seeds so a different --seed gives an
// INDEPENDENT training run (for replication / multi-seed evaluation). Default '' is byte-identical.
const SEED = arg('seed', '');
const sfx = SEED ? `-${SEED}` : '';
const enc = createEncoder(content, undefined, { positionalHand: false, enemyIntent: INTENT });
console.log(`encoder: obs=${enc.size} enemyIntent=${INTENT} seed=${SEED || '(default)'}`);
const initRng = new Rng(seedFromString(`uni-init${sfx}`));
const net: NetParams = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
const searchRng = (() => { const r = new Rng(seedFromString(`uni-search${sfx}`)); return () => r.next(); })();
const qRng = (() => { const r = new Rng(seedFromString(`uni-q${sfx}`)); return () => r.next(); })();
const mixRng = (() => { const r = new Rng(seedFromString(`uni-mix${sfx}`)); return () => r.next(); })();
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

const D: TrainSample[] = [];
// DAgger over aggregated data is non-monotonic and unstable (train loss climbs as D grows; the
// per-round no-search win rate swings, and different classes peak in different rounds), so the
// LAST round's net is a noisy draw. Snapshot the best-eval round and save that instead.
let bestScore = -1;
let bestNet: NetParams = cloneNet(net);
let bestRound = 0;

for (let round = 0; round < ROUNDS; round++) {
  const beta = round === 0 ? 1 : BETA0 * BETA_DECAY ** (round - 1);
  let added = 0;
  let ep = 0;
  while (added < STATES_PER_ROUND) {
    const cell = GRID[(round * 5 + ep) % GRID.length] ?? { cls: CHARACTER_IDS[0]!, d: 1, acts: 1 };
    const { cls, d, acts } = cell;
    const config: RunConfig = classConfig(cls, { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts });
    const useGreedy = d <= 1.0;
    let s: RunState = createRun(content, `uni${sfx}-${round}-${ep}`, config);
    for (let i = 0; i < 6000 && s.phase !== 'victory' && s.phase !== 'defeat' && added < STATES_PER_ROUND; i++) {
      let expertAction: GameAction;
      let value: number;
      if (useGreedy) {
        expertAction = greedyAction(s, content, searchRng);
        value = qDeterminized(content, s, expertAction, K, qRng);
      } else {
        const res = ismctsSearch(content, s, { iterations: ISMCTS_ITERS, rand: searchRng });
        expertAction = res.action;
        value = res.rootValue;
      }
      const slot = slotOf(s, expertAction);
      const { mask } = actionMask(content, s);
      if (slot !== null) {
        const pi = new Float32Array(ACTION_SPACE);
        pi[slot] = 1;
        D.push({ x: enc.encode(s), pi, mask, z: value });
        added++;
      }
      const played: GameAction = mixRng() < beta ? expertAction : policyAction(content, s, enc, net);
      s = applyAction(content, s, played);
    }
    ep++;
  }

  let loss = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) loss = trainStep(net, D, LR, L2).loss;

  // Per-class no-search base + hard win rate — reads whether the shared net handles each class
  // (a Knight-only aggregate would hide the class it didn't train, which earlier confounding did).
  const perClass = CLASSES.map((cls) => {
    const b = policyWinRate(content, enc, net, classConfig(cls, DEFAULT_RUN_CONFIG), evalSeeds);
    const h = policyWinRate(content, enc, net, classConfig(cls, { ...DEFAULT_RUN_CONFIG, enemyHpMult: 1.5 }), evalSeeds);
    return { cls, b, h };
  });
  // Combined selection score: mean over classes of (base + hard)/2 — rewards a net that handles
  // every class across difficulties, not one that spikes on a single cell.
  const score = perClass.reduce((a, pc) => a + (pc.b + pc.h) / 2, 0) / Math.max(1, perClass.length);
  if (score > bestScore) {
    bestScore = score;
    bestNet = cloneNet(net); // snapshot BEFORE the next round mutates `net` in place
    bestRound = round;
  }
  const cells = perClass.map((pc) => `${pc.cls}(base${(pc.b * 100).toFixed(0)}/hp1.5=${(pc.h * 100).toFixed(0)})`).join(' ');
  console.log(
    `round ${round}: beta=${beta.toFixed(2)} |D|=${D.length} loss=${loss.toFixed(4)} ` +
      `score=${(score * 100).toFixed(1)} no-search ${cells}`,
  );
}

saveCheckpoint(OUT, enc.manifest, bestNet);
console.log(
  `saved BEST round ${bestRound} (score ${(bestScore * 100).toFixed(1)}) -> ${OUT}  ` +
    `(then: hybrid.ts to measure search at base+hard)`,
);
