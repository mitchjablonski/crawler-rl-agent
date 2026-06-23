/**
 * Distill a trained AlphaZero-lite teacher into a fast NO-SEARCH policy net (dev tool).
 *
 *   npx tsx scripts/distill.ts --teacher=.models/az.json --out=.models/distilled.json \
 *     --episodes=40 --epochs=200 --iters=32 --hidden=128 --lr=0.02
 *
 * Loads the teacher checkpoint, generates a dataset of search-improved (state, π, z)
 * by self-playing the teacher with PUCT, fits a student net to imitate it, then
 * compares teacher (PUCT) vs student (no search) held-out win rate. The student
 * plays with one forward pass per move.
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { type NetParams, createNet } from '../src/search/net.js';
import { assertCompatible, loadCheckpoint, saveCheckpoint } from '../src/search/checkpoint.js';
import { distill } from '../src/search/distill.js';
import { policyWinRate } from '../src/search/policy.js';
import { evaluateWinRate } from '../src/search/train.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const TEACHER = arg('teacher', '.models/az.json');
const OUT = arg('out', '.models/distilled.json');
const EPISODES = Number(arg('episodes', '40'));
const EPOCHS = Number(arg('epochs', '200'));
const ITERS = Number(arg('iters', '32'));
const HIDDEN = Number(arg('hidden', '128'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const EVAL_RUNS = Number(arg('evalRuns', '20'));

const ckpt = loadCheckpoint(TEACHER);
const encoder = createEncoder(content, ckpt.manifest); // same indices the teacher trained with
assertCompatible(ckpt, encoder.manifest);
const teacherNet = ckpt.model as NetParams;

const config: RunConfig = { ...DEFAULT_RUN_CONFIG };
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);
const searchRng = (() => {
  const r = new Rng(seedFromString('distill-search'));
  return () => r.next();
})();

const teacher = { content, encoder, net: teacherNet, config, searchIterations: ITERS, rand: searchRng };
const teacherWr = evaluateWinRate(teacher, evalSeeds);
console.log(
  `teacher fp=${ckpt.fingerprint} PUCT(iters=${ITERS}) held-out win rate: ${(teacherWr * 100).toFixed(1)}%`,
);

const initRng = new Rng(seedFromString('student-init'));
const student = createNet(
  { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
  () => initRng.next(),
);

console.log(`distilling: episodes=${EPISODES} epochs=${EPOCHS} hidden=${HIDDEN} lr=${LR}`);
distill({
  teacher,
  student,
  datasetEpisodes: EPISODES,
  epochs: EPOCHS,
  lr: LR,
  l2: L2,
  onEpoch: (e, stats, n) => {
    if (e % 20 === 0 || e === EPOCHS - 1) {
      console.log(
        `  epoch ${e}: loss=${stats.loss.toFixed(4)} ` +
          `(p=${stats.policyLoss.toFixed(4)} v=${stats.valueLoss.toFixed(4)}) samples=${n}`,
      );
    }
  },
});

const studentWr = policyWinRate(content, encoder, student, config, evalSeeds);
console.log(`student (NO search) held-out win rate: ${(studentWr * 100).toFixed(1)}%`);
saveCheckpoint(OUT, encoder.manifest, student);
console.log(`saved distilled net -> ${OUT} (fingerprint ${ckpt.fingerprint})`);
