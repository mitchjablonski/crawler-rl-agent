/**
 * Balance tool #4 — statistical attribution (the upgrade over one-at-a-time ablation).
 *
 * Runs ONE large corpus of games, records which content each run had + whether it won,
 * and fits a ridge logistic regression of win on content presence. Output: every item's
 * marginal association with winning (odds ratio + approximate, ridge-penalized 95% CI), from a single
 * pass — controlling for the others and for difficulty. Ranks overtuned (top +) and
 * undertuned/trap (top −) candidates together.
 *
 * Default player is greedy (fast — a few thousand runs in ~minutes); pass --ckpt
 * --player=hybrid for the optimal agent (much slower; use fewer runs).
 *
 * Associational with controls, not pure causal (winners survive longer → draft more, a
 * survivorship tilt we can't fully remove here). Use it to SCREEN, then confirm the
 * extremes with balance-ablation.ts (causal) or balance-equity.ts (survivorship-free).
 *
 *   npx tsx scripts/balance-attribution.ts --runs=3000 --difficulties=1.0,1.5,2.0 --acts=1,3
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { RunConfig } from '../src/engine/run.js';
import { createEncoder } from '../src/search/encode.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { type Player, greedyPlayer, hybridPlayer, policyPlayer } from '../src/search/balance.js';
import { type Term, collectCorpus, fitLogistic } from '../src/search/attribution.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const RUNS = Number(arg('runs', '3000'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0').split(',').map(Number).filter((n) => n > 0);
const ARCS = arg('acts', '1,3').split(',').map(Number).filter((n) => n >= 1);
const ITERS = Number(arg('iters', '120'));
const L2 = Number(arg('l2', '1'));
const TOP = Number(arg('top', '12'));
const CKPT = arg('ckpt', '');
const PLAYER = arg('player', CKPT ? 'hybrid' : 'greedy');

const rng = (() => { const r = new Rng(seedFromString('attrib')); return () => r.next(); })();
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

const specs = Array.from({ length: RUNS }, (_, i) => {
  const d = DIFFICULTIES[i % DIFFICULTIES.length] ?? 1;
  const acts = ARCS[Math.floor(i / DIFFICULTIES.length) % ARCS.length] ?? 1;
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: d, acts };
  return { seed: `attr-${i}`, config };
});

console.log(`player=${PLAYER} runs=${RUNS} difficulties=${DIFFICULTIES.join(',')} acts=${ARCS.join(',')} l2=${L2}`);
console.log('collecting corpus...');
const corpus = collectCorpus(content, player, specs);
console.log('fitting logistic model...');
const fit = fitLogistic(corpus, { l2: L2 });
console.log(
  `\nn=${fit.n} winRate=${(fit.winRate * 100).toFixed(1)}% features=${fit.terms.length} ` +
    `(dropped ${fit.droppedConstant.length} constant)\n`,
);

const sig = (t: Term): string => (Math.abs(t.z) >= 1.96 ? '*' : ' ');
function show(title: string, terms: Term[]): void {
  console.log(`== ${title} ==`);
  console.log('item                          OR     95% CI            z      freq');
  for (const t of terms) {
    const id = t.name.replace(/^[a-z]+:/, '');
    const lo = Math.exp(t.ci95[0]).toFixed(2);
    const hi = Math.exp(t.ci95[1]).toFixed(2);
    console.log(
      `${sig(t)}${id.padEnd(27)} ${t.oddsRatio.toFixed(2).padStart(5)}  [${lo.padStart(5)},${hi.padStart(6)}]  ` +
        `${t.z.toFixed(1).padStart(5)}  ${(t.freq * 100).toFixed(0).padStart(3)}%`,
    );
  }
  console.log();
}

for (const kind of ['relic', 'card', 'potion'] as const) {
  const terms = fit.terms.filter((t) => t.kind === kind).sort((a, b) => b.beta - a.beta);
  if (terms.length === 0) continue;
  const top = terms.slice(0, TOP);
  const bottom = terms.slice(-TOP).filter((t) => !top.includes(t));
  show(`${kind.toUpperCase()}S — strongest (overtuned candidates)`, top);
  show(`${kind.toUpperCase()}S — weakest / traps (undertuned candidates)`, bottom);
}
console.log('* = |z| ≥ 1.96 (approx 95%, ridge-penalized Wald — shrunk/biased toward OR 1, a screen not');
console.log('  an exact test). OR>1 helps win, <1 hurts. freq = % of runs with it (ignore for ctrl: rows).');
console.log('Associational with controls — confirm extremes with balance-ablation.ts / balance-equity.ts.');
