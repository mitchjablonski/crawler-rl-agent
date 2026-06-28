/**
 * Value-head calibration check — is the net's predicted win probability honest, or are the
 * determinized targets making it OVERCONFIDENT?
 *
 * Samples states off greedy play across difficulties, then for each compares V(s) to the realized
 * greedy win probability (MC over re-seeded futures). Prints a reliability diagram + ECE + the net
 * over/under-confidence. A large positive overconfidence is direct evidence of biased value targets
 * (the strategy-fusion hypothesis).
 *
 *   npx tsx scripts/value-calibration.ts --ckpt=.models/unified.json --states=400 --reseeds=20
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { greedyPlayer } from '../src/search/balance.js';
import { sampleStates } from '../src/search/equity.js';
import { calibrate, realizedWin } from '../src/search/calibration.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const CKPT = arg('ckpt', '.models/unified.json');
const STATES = Number(arg('states', '400'));
const RESEEDS = Number(arg('reseeds', '20'));
const STRIDE = Number(arg('stride', '5'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1').split(',').map(Number).filter((n) => n >= 1);

const ckpt = loadCheckpoint(CKPT);
const enc = createEncoder(content, ckpt.manifest);
const net = ckpt.model as NetParams;
const rng = (() => { const r = new Rng(seedFromString('calib')); return () => r.next(); })();

const specs = Array.from({ length: 300 }, (_, i) => {
  const d = DIFFICULTIES[i % DIFFICULTIES.length] ?? 1;
  const acts = ARCS[Math.floor(i / DIFFICULTIES.length) % ARCS.length] ?? 1;
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
  return { seed: `cal-${i}`, config };
});

console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint} — sampling up to ${STATES} states...`);
const states = sampleStates(content, greedyPlayer(rng), specs, STRIDE, STATES);
console.log(`computing realized greedy win over ${RESEEDS} re-seeds for ${states.length} states...`);
const realized = states.map((s) => realizedWin(content, s, RESEEDS, rng));
const cal = calibrate(enc, net, states, realized, 10);

console.log(`\nn=${cal.n}  mean predicted V=${(cal.meanPred * 100).toFixed(1)}%  ` +
  `mean realized=${(cal.meanReal * 100).toFixed(1)}%`);
console.log(`OVERCONFIDENCE (pred − real) = ${(cal.overconfidence * 100).toFixed(1)} pts   ECE = ${(cal.ece * 100).toFixed(1)} pts\n`);
console.log('predicted-V bin   n     mean-pred   mean-real   gap');
for (const b of cal.bins) {
  if (b.n === 0) continue;
  const gap = (b.meanPred - b.meanReal) * 100;
  const bar = gap > 0 ? '+'.repeat(Math.min(20, Math.round(gap / 2))) : '-'.repeat(Math.min(20, Math.round(-gap / 2)));
  console.log(
    `[${b.lo.toFixed(1)},${b.hi.toFixed(1)})      ${String(b.n).padStart(4)}   ` +
      `${(b.meanPred * 100).toFixed(0).padStart(6)}%     ${(b.meanReal * 100).toFixed(0).padStart(6)}%   ` +
      `${gap >= 0 ? '+' : ''}${gap.toFixed(0).padStart(3)}  ${bar}`,
  );
}
console.log('\ngap = predicted − realized (per bin). Positive = the value head is overconfident there.');
