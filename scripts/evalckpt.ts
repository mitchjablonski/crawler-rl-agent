/**
 * Evaluate a saved checkpoint's PUCT win rate at given search-iters on held-out seeds.
 * Triangulates "is the plateau the net or the search budget?".
 *   npx tsx scripts/evalckpt.ts --ckpt=.models/strong.json --iters=48,192 --runs=20
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import { createEncoder } from '../src/search/encode.js';
import { type NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { evaluateWinRate } from '../src/search/train.js';
import { policyWinRate } from '../src/search/policy.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const CKPT = arg('ckpt', '.models/strong.json');
const ITERS = arg('iters', '48,192')
  .split(',')
  .map((s) => Number(s));
const RUNS = Number(arg('runs', '20'));

const ckpt = loadCheckpoint(CKPT);
const encoder = createEncoder(content, ckpt.manifest);
const net = ckpt.model as NetParams;
const seeds = Array.from({ length: RUNS }, (_, i) => `eval-${i}`);

console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint} size=${encoder.size} runs=${RUNS}`);

const noSearch = policyWinRate(content, encoder, net, DEFAULT_RUN_CONFIG, seeds);
console.log(`  no-search policy: ${(noSearch * 100).toFixed(1)}%`);

for (const iters of ITERS) {
  const rand = (() => {
    const r = new Rng(seedFromString('evalckpt'));
    return () => r.next();
  })();
  const wr = evaluateWinRate(
    { content, encoder, net, config: DEFAULT_RUN_CONFIG, searchIterations: iters, rand },
    seeds,
  );
  console.log(`  PUCT iters=${iters}: ${(wr * 100).toFixed(1)}%`);
}
