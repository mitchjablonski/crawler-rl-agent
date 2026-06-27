/**
 * Graded-nerf probe for the one balance lead that survived confirmation: Whetstone
 * (+2 Strength at combat start). Instead of a binary ablate, sweep the Strength it
 * grants (0/1/2/3) and measure the optimal agent's win rate at a difficulty with
 * headroom. Reads the *shape* of the contribution:
 *   - if win rate is flat from 1→2 Strength, the 2nd point is "free power" (overtuned).
 *   - if it climbs steadily, the value is earned (leave it).
 *
 *   npx tsx scripts/whetstone-grade.ts --runs=120 --difficulty=2.0 --ckpt=.models/unified_m38.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import type { ContentRegistry, Effect } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { type Player, evaluatePlayer, greedyPlayer, hybridPlayer } from '../src/search/balance.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const RUNS = Number(arg('runs', '120'));
const DIFF = Number(arg('difficulty', '2.0'));
const ACTS = Number(arg('acts', '1'));
const ITERS = Number(arg('iters', '120'));
const CKPT = arg('ckpt', '');
const LEVELS = arg('levels', '0,1,2,3').split(',').map(Number);

const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFF, acts: ACTS };
const seeds = Array.from({ length: RUNS }, (_, i) => `abl-${i}`); // same seeds as ablation, for comparability
const freshRng = (): (() => number) => { const r = new Rng(seedFromString('ablation')); return () => r.next(); };

let makePlayer: () => Player;
if (!CKPT) {
  makePlayer = () => greedyPlayer(freshRng());
  console.log('(no --ckpt: greedy player — pass a checkpoint for the optimal agent)');
} else {
  const ckpt = loadCheckpoint(CKPT);
  const enc = createEncoder(content, ckpt.manifest);
  const net = ckpt.model as NetParams;
  makePlayer = () => hybridPlayer(enc, net, freshRng(), ITERS);
  console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint}`);
}

/** Whetstone granting `stacks` Strength at combat start (stacks=0 → inert). */
function whetstoneAt(stacks: number): ContentRegistry {
  const w = content.relics['whetstone'];
  if (!w) throw new Error('whetstone not found in content');
  const effects: Effect[] =
    stacks > 0 ? [{ kind: 'applyStatus', status: 'strength', stacks, target: 'self' }] : [];
  return { ...content, relics: { ...content.relics, whetstone: { ...w, effects } } };
}

console.log(`whetstone graded sweep — runs=${RUNS} enemyHpMult=${DIFF} acts=${ACTS}\n`);
console.log('strength   win rate');
let prev: number | null = null;
for (const s of LEVELS) {
  const win = evaluatePlayer(whetstoneAt(s), config, makePlayer(), seeds).winRate;
  const step = prev === null ? '' : `   (${((win - prev) * 100 >= 0 ? '+' : '')}${((win - prev) * 100).toFixed(1)} vs prev)`;
  console.log(`  +${s} Str   ${(win * 100).toFixed(1)}%${step}`);
  prev = win;
}
console.log('\nread: a flat 1→2 step = the live +2 is over-costed; a steady climb = earned.');
