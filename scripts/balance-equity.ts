/**
 * Balance tool #5 — value-head equity screen (survivorship-free, very fast).
 *
 * Samples real states, then for each card reads the value head's equity swing of adding
 * one copy to the deck: ΔV = V(deck+card) − V(deck), averaged over states. No rollouts,
 * no full episodes, no survivorship confound — just the agent's learned "does this card
 * raise my win probability". A cheap pre-filter to rank all content (high ΔV = strong /
 * overtuned candidate; near-0 = filler; negative = the value head dislikes it).
 *
 * Needs a checkpoint (it reads the value head). Reflects only what the net learned, so it
 * SCREENS — confirm the extremes with balance-ablation.ts.
 *
 *   npx tsx scripts/balance-equity.ts --ckpt=.models/unified_m38.json --states=1500 --top=15
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { greedyPlayer } from '../src/search/balance.js';
import { cardEquity, sampleStates } from '../src/search/equity.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const CKPT = arg('ckpt', '.models/unified_m38.json');
const STATES = Number(arg('states', '1500'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1,3').split(',').map(Number).filter((n) => n >= 1);
const STRIDE = Number(arg('stride', '4'));
const TOP = Number(arg('top', '15'));

const ckpt = loadCheckpoint(CKPT);
const enc = createEncoder(content, ckpt.manifest);
const net = ckpt.model as NetParams;
const rng = (() => { const r = new Rng(seedFromString('equity')); return () => r.next(); })();

// Sample states off the greedy player's trajectories (cheap; we only need representative states).
const specs = Array.from({ length: 400 }, (_, i) => {
  const d = DIFFICULTIES[i % DIFFICULTIES.length] ?? 1;
  const acts = ARCS[Math.floor(i / DIFFICULTIES.length) % ARCS.length] ?? 1;
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
  return { seed: `eq-${i}`, config };
});

console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint} — sampling up to ${STATES} states...`);
const states = sampleStates(content, greedyPlayer(rng), specs, STRIDE, STATES);
console.log(`scoring ${Object.keys(content.cards).length} cards over ${states.length} states...\n`);
const scores = cardEquity(content, enc, net, states);

const fmt = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}`;
console.log(`-- strongest cards by value-head equity (ΔV ≈ Δ win%, top ${TOP}) --`);
for (const s of scores.slice(0, TOP)) {
  console.log(`  ${s.cardId.padEnd(28)} ${fmt(s.meanDelta).padStart(7)}%  (±${(s.seDelta * 100).toFixed(2)})`);
}
console.log(`\n-- weakest / disliked cards (bottom ${TOP}) --`);
for (const s of scores.slice(-TOP).reverse()) {
  console.log(`  ${s.cardId.padEnd(28)} ${fmt(s.meanDelta).padStart(7)}%  (±${(s.seDelta * 100).toFixed(2)})`);
}
console.log('\nΔV = mean value-head swing from adding one copy. Screen only — confirm with ablation.');
