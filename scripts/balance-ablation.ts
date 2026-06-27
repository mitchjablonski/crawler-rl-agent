/**
 * Balance tool #3 — content ablation (power ranking).
 *
 * For each card/relic/potion, neutralize it (effects stripped, kept in the pool so draw
 * order is preserved) and re-measure win rate on the SAME seeds. The delta is that
 * item's contribution:
 *   large positive delta (baseline win - nerfed win) => load-bearing / over-relied (nerf candidate)
 *   ~zero delta                                       => irrelevant or already-dead content (buff/cut candidate)
 *   negative delta (nerf *raises* win rate)           => a trap the player is better off without
 *
 * Default player is greedy (fast, no model). With --ckpt --player=hybrid you get the
 * optimal agent, which also *avoids* a nerfed option — closer to true option value, but
 * much slower, so scope it with --kind / --top / smaller --runs.
 *
 *   npx tsx scripts/balance-ablation.ts --kind=relics --runs=40 --difficulty=1.5
 *   npx tsx scripts/balance-ablation.ts --kind=cards --runs=30 --top=20 --difficulty=1.0
 *   # targeted high-run confirmation of specific leads with the optimal agent:
 *   npx tsx scripts/balance-ablation.ts --kind=relics --only=pocket-dice,whetstone \
 *     --runs=150 --difficulty=1.5 --ckpt=.models/unified_m38.json --player=hybrid
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import type { ContentRegistry } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import {
  type Player,
  evaluatePlayer,
  greedyPlayer,
  hybridPlayer,
  nerfCard,
  nerfPotion,
  nerfRelic,
  policyPlayer,
} from '../src/search/balance.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const KIND = arg('kind', 'relics') as 'cards' | 'relics' | 'potions';
const RUNS = Number(arg('runs', '40'));
const DIFF = Number(arg('difficulty', '1.5'));
const ACTS = Number(arg('acts', '1'));
const ITERS = Number(arg('iters', '120'));
const TOP = Number(arg('top', '0')); // 0 = all
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean); // restrict to these ids
const CKPT = arg('ckpt', '');
const PLAYER = arg('player', CKPT ? 'hybrid' : 'greedy');

const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFF, acts: ACTS };
const seeds = Array.from({ length: RUNS }, (_, i) => `abl-${i}`);
// Fresh rng per evaluation keeps search noise identical between baseline and each nerf.
const freshRng = (): (() => number) => {
  const r = new Rng(seedFromString('ablation'));
  return () => r.next();
};

let makePlayer: () => Player;
if (PLAYER === 'greedy' || !CKPT) {
  makePlayer = () => greedyPlayer(freshRng());
} else {
  const ckpt = loadCheckpoint(CKPT);
  const enc = createEncoder(content, ckpt.manifest);
  const net = ckpt.model as NetParams;
  makePlayer = PLAYER === 'policy' ? () => policyPlayer(enc, net) : () => hybridPlayer(enc, net, freshRng(), ITERS);
  console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint}`);
}

const winRate = (c: ContentRegistry): number => evaluatePlayer(c, config, makePlayer(), seeds).winRate;

let ids = (() => {
  if (KIND === 'cards') return Object.keys(content.cards).filter((id) => content.cards[id]?.rarity !== 'starter');
  if (KIND === 'potions') return Object.keys(content.potions);
  return Object.keys(content.relics);
})().sort();
if (ONLY.length > 0) ids = ids.filter((id) => ONLY.includes(id)); // targeted confirmation runs
const nerf = KIND === 'cards' ? nerfCard : KIND === 'potions' ? nerfPotion : nerfRelic;

console.log(`player=${PLAYER} kind=${KIND} items=${ids.length} runs=${RUNS} enemyHpMult=${DIFF} acts=${ACTS}\n`);
const baseline = winRate(content);
console.log(`baseline win rate: ${(baseline * 100).toFixed(1)}%\n`);

const results: Array<{ id: string; win: number; delta: number }> = [];
for (const id of ids) {
  const win = winRate(nerf(content, id));
  results.push({ id, win, delta: baseline - win }); // +delta => nerfing it hurt => it was contributing
  process.stdout.write('.');
}
console.log('\n');

results.sort((a, b) => b.delta - a.delta);
const shown = TOP > 0 ? results.slice(0, TOP) : results;
console.log('item                          nerfed-win   Δ vs baseline');
for (const r of shown) {
  const sign = r.delta > 0 ? '+' : '';
  console.log(
    `${r.id.padEnd(28)}  ${(r.win * 100).toFixed(1).padStart(5)}%      ${sign}${(r.delta * 100).toFixed(1)} pts`,
  );
}
console.log(
  `\nlegend: +Δ = load-bearing (removing it lowers win rate → nerf candidate); ` +
    `~0 = irrelevant/dead; -Δ = trap (player better off without it).`,
);
