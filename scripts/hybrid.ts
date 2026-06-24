/**
 * Evaluate a checkpoint across difficulties with: no-search, net-value PUCT, and
 * HYBRID PUCT (net priors + greedy rollout value at leaves). Hybrid keeps the
 * net's good priors but uses true-ish rollout values — the shot at ~100%.
 *
 *   npx tsx scripts/hybrid.ts --ckpt=.models/dagger_greedy.json --iters=160,400 \
 *     --difficulties=1.0 --runs=40
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { puctAction } from '../src/search/puct.js';
import { greedyRollout } from '../src/search/heuristic.js';
import { policyWinRate } from '../src/search/policy.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const CKPT = arg('ckpt', '.models/dagger_greedy.json');
const ITERS = arg('iters', '160,400').split(',').map(Number);
const RUNS = Number(arg('runs', '40'));
const PRIOR_MIX = Number(arg('priorMix', '0'));
const DIFFICULTIES = arg('difficulties', '1.0').split(',').map(Number);
const ARCS = arg('acts', '1').split(',').map(Number).filter((n) => n >= 1);

const ckpt = loadCheckpoint(CKPT);
const enc = createEncoder(content, ckpt.manifest);
const net = ckpt.model as NetParams;
const seeds = Array.from({ length: RUNS }, (_, i) => `eval-${i}`);

function puctWinRate(config: RunConfig, iters: number, hybrid: boolean, tag: string): number {
  let wins = 0;
  for (const seed of seeds) {
    const rng = new Rng(seedFromString(`hyb-${tag}-${iters}-${hybrid}`));
    const rand = (): number => rng.next();
    let s: RunState = createRun(content, seed, config);
    for (let i = 0; i < 6000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(
        content,
        s,
        puctAction(content, s, {
          encoder: enc,
          net,
          iterations: iters,
          rand,
          leafRollout: hybrid ? greedyRollout : undefined,
          priorMix: PRIOR_MIX,
        }),
      );
    }
    if (s.phase === 'victory') wins++;
  }
  return wins / seeds.length;
}

console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint} size=${enc.size} runs=${RUNS}`);
for (const acts of ARCS) {
  for (const d of DIFFICULTIES) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
    const tag = `a${acts}d${d}`;
    console.log(`\n=== acts=${acts} enemyHpMult=${d} ===`);
    console.log(`  no-search:        ${(policyWinRate(content, enc, net, config, seeds) * 100).toFixed(1)}%`);
    for (const iters of ITERS) {
      console.log(`  net-PUCT  ${iters}:    ${(puctWinRate(config, iters, false, tag) * 100).toFixed(1)}%`);
      console.log(`  hybrid    ${iters}:    ${(puctWinRate(config, iters, true, tag) * 100).toFixed(1)}%`);
    }
  }
}
