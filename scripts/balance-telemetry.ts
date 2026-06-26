/**
 * Balance tool #2 — content usage telemetry + enemy lethality.
 *
 * Runs a player over many seeds and records what it actually *uses*: which cards it
 * drafts / buys / plays / upgrades, which potions it uses, and how much HP each enemy
 * costs. Surfaces:
 *   - DEAD content  — cards/relics/potions the player never picks or plays (candidates
 *                     to buff or cut).
 *   - AUTO-INCLUDE  — content taken almost every time it's offered (candidates to nerf).
 *   - DIFFICULTY SPIKES — enemies with the highest HP cost per encounter.
 *
 * Default player is greedy (fast, no model). Pass --ckpt --player=hybrid for the
 * optimal agent's choices (slower, but reflects skilled play).
 *
 *   npx tsx scripts/balance-telemetry.ts --runs=200 --difficulties=1.0,1.5 --acts=1,3
 *   npx tsx scripts/balance-telemetry.ts --runs=40 --ckpt=.models/unified_m38.json --player=hybrid
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import {
  type Player,
  type UsageCounts,
  emptyUsage,
  greedyPlayer,
  hybridPlayer,
  policyPlayer,
  runEpisode,
  telemetryHook,
} from '../src/search/balance.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const RUNS = Number(arg('runs', '200'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1,3').split(',').map(Number).filter((n) => n >= 1);
const ITERS = Number(arg('iters', '160'));
const CKPT = arg('ckpt', '');
const PLAYER = arg('player', CKPT ? 'hybrid' : 'greedy');
const TOP = Number(arg('top', '12'));

const rng = (() => { const r = new Rng(seedFromString('telemetry')); return () => r.next(); })();
let player: Player;
if (PLAYER === 'greedy' || !CKPT) {
  player = greedyPlayer(rng);
} else {
  const ckpt = loadCheckpoint(CKPT);
  const enc = createEncoder(content, ckpt.manifest);
  const net = ckpt.model as NetParams;
  player = PLAYER === 'policy' ? policyPlayer(enc, net) : hybridPlayer(enc, net, rng, ITERS);
  console.log(`ckpt=${CKPT} fp=${ckpt.fingerprint}`);
}
console.log(`player=${PLAYER} runs=${RUNS} difficulties=${DIFFICULTIES.join(',')} acts=${ARCS.join(',')}`);
if (PLAYER === 'greedy') {
  console.log(
    'note: the greedy player never uses potions, upgrades cards, or buys potions — so those\n' +
      '      showing as "dead" reflects greedy\'s blindspots, not weak content. Use --player=hybrid\n' +
      '      (with --ckpt) to measure potion/upgrade balance.',
  );
}
console.log();

const u: UsageCounts = emptyUsage();
const hook = telemetryHook(u);
let wins = 0;
for (let i = 0; i < RUNS; i++) {
  const d = DIFFICULTIES[i % DIFFICULTIES.length] ?? 1;
  const acts = ARCS[Math.floor(i / DIFFICULTIES.length) % ARCS.length] ?? 1;
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
  const m = runEpisode(content, `tel-${i}`, config, player, hook);
  if (m.won) wins++;
}
console.log(`win rate over telemetry runs: ${((wins / RUNS) * 100).toFixed(1)}%\n`);

const top = (m: Map<string, number>, n = TOP): Array<[string, number]> =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function section(title: string, m: Map<string, number>): void {
  console.log(`-- ${title} (top ${TOP}) --`);
  const rows = top(m);
  if (rows.length === 0) console.log('  (none)');
  for (const [id, n] of rows) console.log(`  ${id.padEnd(28)} ${n}`);
  console.log();
}

section('cards drafted', u.picked);
section('cards played', u.played);
section('cards bought', u.bought);
section('cards upgraded', u.upgraded);
section('potions used', u.potionUsed);

// Dead content: draftable cards the player NEVER picked AND never played.
const allCards = Object.keys(content.cards).filter((id) => content.cards[id]?.rarity !== 'starter');
const deadCards = allCards.filter((id) => !u.picked.has(id) && !u.played.has(id) && !u.bought.has(id));
console.log(`-- DEAD cards (never picked/bought/played across ${RUNS} runs): ${deadCards.length}/${allCards.length} --`);
console.log(deadCards.length ? `  ${deadCards.join(', ')}` : '  (none — every card saw use)');
console.log();
const deadPotions = Object.keys(content.potions).filter((id) => !u.potionUsed.has(id) && !u.potionBought.has(id));
console.log(`-- DEAD potions: ${deadPotions.length}/${Object.keys(content.potions).length} --`);
console.log(deadPotions.length ? `  ${deadPotions.join(', ')}` : '  (none)');
console.log();

// Difficulty spikes: enemies by average player HP lost per combat step they're present.
console.log('-- enemy lethality (avg player HP lost per step on field; min 20 steps) --');
const lethality = [...u.enemySteps.entries()]
  .filter(([, steps]) => steps >= 20)
  .map(([id, steps]) => [id, (u.enemyDamage.get(id) ?? 0) / steps] as [string, number])
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP);
for (const [id, perStep] of lethality) {
  console.log(`  ${id.padEnd(28)} ${perStep.toFixed(2)} hp/step  (${u.enemySteps.get(id)} steps)`);
}
