/**
 * Relic A/B confirmation — the clean test for a low-frequency relic.
 *
 * Plain ablation barely moves overall win rate for a relic only ~14% of runs hold, even
 * if it's strong for those runs. So instead: GRANT the relic as a starting relic (every
 * run holds it), then compare win rate with it working vs. neutralized. The delta is its
 * value *when held*, isolated — and running it for both greedy (median) and hybrid
 * (optimal) tests whether a lead is playstyle-dependent.
 *
 *   npx tsx scripts/relic-ab.ts --relic=tempo-band --difficulties=1.5,2.0 \
 *     --runs=400 --hruns=120 --ckpt=.models/unified_m38.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { type Player, evaluatePlayer, greedyPlayer, hybridPlayer, nerfRelic } from '../src/search/balance.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const RELIC = arg('relic', 'tempo-band');
const DIFFICULTIES = arg('difficulties', '1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ACTS = Number(arg('acts', '1'));
const RUNS = Number(arg('runs', '400')); // greedy
const HRUNS = Number(arg('hruns', '120')); // hybrid
const ITERS = Number(arg('iters', '120'));
const CKPT = arg('ckpt', '');

if (!content.relics[RELIC]) throw new Error(`unknown relic '${RELIC}'`);
const contentNerf = nerfRelic(content, RELIC);
const freshRng = (): (() => number) => { const r = new Rng(seedFromString('relic-ab')); return () => r.next(); };

const tiers: Array<{ name: string; runs: number; make: () => Player }> = [
  { name: 'median(greedy)', runs: RUNS, make: () => greedyPlayer(freshRng()) },
];
if (CKPT) {
  const ckpt = loadCheckpoint(CKPT);
  const enc = createEncoder(content, ckpt.manifest);
  const net = ckpt.model as NetParams;
  tiers.push({ name: `optimal(hybrid@${ITERS})`, runs: HRUNS, make: () => hybridPlayer(enc, net, freshRng(), ITERS) });
  console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint}`);
}

console.log(`relic A/B: '${RELIC}' granted as a starting relic (held by every run)\n`);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

for (const d of DIFFICULTIES) {
  // Granting the relic to the starter set guarantees 100% prevalence; the only difference
  // between conditions is whether its effect fires (full content vs. nerfed content).
  const starting = [...(DEFAULT_RUN_CONFIG.startingRelics ?? []), RELIC];
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts: ACTS, startingRelics: starting };
  console.log(`=== enemyHpMult=${d} acts=${ACTS} ===`);
  for (const tier of tiers) {
    const seeds = Array.from({ length: tier.runs }, (_, i) => `ab-${i}`);
    const full = evaluatePlayer(content, config, tier.make(), seeds).winRate;
    const nerfed = evaluatePlayer(contentNerf, config, tier.make(), seeds).winRate;
    console.log(
      `  ${tier.name.padEnd(20)} with=${pct(full).padStart(6)}  without=${pct(nerfed).padStart(6)}  ` +
        `Δ=${(full - nerfed >= 0 ? '+' : '')}${((full - nerfed) * 100).toFixed(1)} pts  (${tier.runs} runs)`,
    );
  }
  console.log();
}
console.log('Δ = win-rate value of the relic when held. Compare median vs optimal to read playstyle-dependence.');
