/**
 * Balance tool #1 — difficulty calibration + skill ladder.
 *
 * Sweeps difficulty (enemyHpMult) × arcs (acts) × player tier and reports win rate plus
 * HP cost / run length / gold, over a fixed seed set. Read it two ways:
 *   - down a column: is a difficulty knob landing each tier on its target win rate?
 *   - across tiers : is skill rewarded? (optimal >> median >> casual = healthy;
 *                    all-equal = luck-dominated; only-optimal-wins = punishing.)
 *
 * Players: greedy (median, no model) always runs. hybrid (optimal) and policy (casual)
 * run only if --ckpt is given.
 *
 *   npx tsx scripts/balance-grid.ts --difficulties=1.0,1.5,2.0 --acts=1,3 --runs=30 \
 *     --ckpt=.models/unified_m38.json --iters=160
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { type Player, evaluatePlayer, greedyPlayer, hybridPlayer, policyPlayer } from '../src/search/balance.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1,3').split(',').map(Number).filter((n) => n >= 1);
const RUNS = Number(arg('runs', '30'));
const ITERS = Number(arg('iters', '160'));
const CKPT = arg('ckpt', '');

const seeds = Array.from({ length: RUNS }, (_, i) => `bal-${i}`);
// One rng per tier, re-seeded fresh per cell so noise is comparable across the grid.
const rng = (tag: string): (() => number) => {
  const r = new Rng(seedFromString(tag));
  return () => r.next();
};

const tiers: Array<{ name: string; player: (tag: string) => Player }> = [
  { name: 'median(greedy)', player: (tag) => greedyPlayer(rng(`g-${tag}`)) },
];
if (CKPT) {
  const ckpt = loadCheckpoint(CKPT);
  const enc = createEncoder(content, ckpt.manifest);
  const net = ckpt.model as NetParams;
  tiers.unshift({ name: `optimal(hybrid@${ITERS})`, player: (tag) => hybridPlayer(enc, net, rng(`h-${tag}`), ITERS) });
  tiers.push({ name: 'casual(policy)', player: () => policyPlayer(enc, net) });
  console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint}`);
} else {
  console.log('(no --ckpt: only the greedy/median tier runs; pass a checkpoint for optimal+casual)');
}

console.log(`runs=${RUNS} difficulties=${DIFFICULTIES.join(',')} acts=${ARCS.join(',')}\n`);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`.padStart(4);

for (const acts of ARCS) {
  for (const d of DIFFICULTIES) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
    console.log(`=== acts=${acts}  enemyHpMult=${d} ===`);
    for (const tier of tiers) {
      const m = evaluatePlayer(content, config, tier.player(`${acts}-${d}`), seeds);
      console.log(
        `  ${tier.name.padEnd(20)} win=${pct(m.winRate)}  ` +
          `dmg=${m.avgDamageTaken.toFixed(0).padStart(4)}  turns=${m.avgTurns.toFixed(0).padStart(3)}  ` +
          `gold=${m.avgFinalGold.toFixed(0).padStart(3)}  deepestAct=${m.avgDeepestAct.toFixed(1)}`,
      );
    }
    console.log();
  }
}
