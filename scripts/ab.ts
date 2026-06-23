/**
 * Controlled A/B: positional-hand encoding vs bag-of-counts, identical budgets.
 *
 *   npx tsx scripts/ab.ts --rounds=40 --episodes=12 --iters=32 --distillEpisodes=40 \
 *     --distillEpochs=200 --winSeeds=60 --agreeSeeds=40
 *
 * For each variant: build the encoder, train a teacher, distill a no-search student,
 * then report (a) teacher PUCT win rate, (b) student no-search win rate, and (c)
 * imitation agreement (low-variance). Same seeds + budget across variants, so the
 * only difference is the encoding.
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { createNet } from '../src/search/net.js';
import { distill } from '../src/search/distill.js';
import { policyWinRate } from '../src/search/policy.js';
import { evaluateWinRate, trainLoop, type SelfPlayOptions } from '../src/search/train.js';
import { imitationAgreement } from '../src/search/eval.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '40'));
const EPISODES = Number(arg('episodes', '12'));
const ITERS = Number(arg('iters', '32'));
const HIDDEN = Number(arg('hidden', '128'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const DISTILL_EPISODES = Number(arg('distillEpisodes', '40'));
const DISTILL_EPOCHS = Number(arg('distillEpochs', '200'));
const WIN_SEEDS = Number(arg('winSeeds', '60'));
const AGREE_SEEDS = Number(arg('agreeSeeds', '40'));
const CURRICULUM = [1.0, 1.5, 2.0];

const config = DEFAULT_RUN_CONFIG;
// Disjoint held-out seed ranges, shared across variants.
const winSeeds = Array.from({ length: WIN_SEEDS }, (_, i) => `eval-${i}`);
const agreeSeeds = Array.from({ length: AGREE_SEEDS }, (_, i) => `agree-${i}`);

interface Variant {
  readonly name: string;
  readonly positionalHand: boolean;
}
const variants: Variant[] = [
  { name: 'positional', positionalHand: true },
  { name: 'bag-of-counts', positionalHand: false },
];

interface Row {
  name: string;
  size: number;
  teacherWin: number;
  studentWin: number;
  agreement: number;
}
const rows: Row[] = [];

for (const variant of variants) {
  console.log(`\n=== variant: ${variant.name} ===`);
  const encoder = createEncoder(content, undefined, { positionalHand: variant.positionalHand });
  console.log(`encoder size=${encoder.size} fp=${encoder.fingerprint}`);

  const teacherInit = new Rng(seedFromString(`${variant.name}-teacher-init`));
  const teacherNet = createNet(
    { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
    () => teacherInit.next(),
  );
  const searchRng = (() => {
    const r = new Rng(seedFromString(`${variant.name}-search`));
    return () => r.next();
  })();
  const teacher: SelfPlayOptions = {
    content,
    encoder,
    net: teacherNet,
    config,
    searchIterations: ITERS,
    rand: searchRng,
  };

  // Train the teacher (same curriculum + budget for both variants).
  trainLoop({
    ...teacher,
    rounds: ROUNDS,
    episodesPerRound: EPISODES,
    lr: LR,
    l2: L2,
    curriculum: (round) => ({ ...config, enemyHpMult: CURRICULUM[round % CURRICULUM.length] ?? 1 }),
    onRound: (r, info) => {
      if (r % 10 === 0 || r === ROUNDS - 1) {
        console.log(`  train round ${r}: loss=${info.stats.loss.toFixed(4)} wins=${info.wins}/${info.episodes}`);
      }
    },
  });

  // Distill a no-search student.
  const studentInit = new Rng(seedFromString(`${variant.name}-student-init`));
  const student = createNet(
    { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
    () => studentInit.next(),
  );
  distill({
    teacher,
    student,
    datasetEpisodes: DISTILL_EPISODES,
    epochs: DISTILL_EPOCHS,
    lr: LR,
    l2: L2,
    onEpoch: (e, stats) => {
      if (e === DISTILL_EPOCHS - 1) console.log(`  distill final: policyLoss=${stats.policyLoss.toFixed(4)}`);
    },
  });

  const teacherWin = evaluateWinRate(teacher, winSeeds);
  const studentWin = policyWinRate(content, encoder, student, config, winSeeds);
  const { agreement, states } = imitationAgreement(content, encoder, student, teacher, agreeSeeds);
  console.log(
    `  teacherWin=${(teacherWin * 100).toFixed(1)}% studentWin=${(studentWin * 100).toFixed(1)}% ` +
      `agreement=${(agreement * 100).toFixed(1)}% (${states} states)`,
  );
  rows.push({ name: variant.name, size: encoder.size, teacherWin, studentWin, agreement });
}

console.log(`\n=== A/B RESULTS (winSeeds=${WIN_SEEDS}, agreeSeeds=${AGREE_SEEDS}, rounds=${ROUNDS}) ===`);
console.log('variant        size  teacherWin  studentWin  imitationAgreement');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(14)} ${String(r.size).padStart(4)}  ` +
      `${(r.teacherWin * 100).toFixed(1).padStart(9)}%  ` +
      `${(r.studentWin * 100).toFixed(1).padStart(9)}%  ` +
      `${(r.agreement * 100).toFixed(1).padStart(16)}%`,
  );
}
