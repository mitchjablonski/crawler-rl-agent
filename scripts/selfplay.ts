/**
 * AlphaZero self-play: the net improves via its OWN net-guided determinized search
 * (azSearch) — no external expert. Each move records (state, π=visit distribution,
 * z=game outcome); because azSearch is determinized, π is a LEARNABLE target. Train,
 * iterate; better net → better search → better targets (the flywheel). Warm-start
 * from the unified net so early self-play isn't garbage.
 *
 *   npx tsx scripts/selfplay.ts --warmFrom=.models/unified.json --rounds=4 \
 *     --episodes=6 --azIters=60 --epochs=80 --difficulties=1.0,1.5 --out=.models/az.json
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE, actionMask } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, type TrainSample, createNet, trainStep } from '../src/search/net.js';
import { azSearch } from '../src/search/azsearch.js';
import { assertCompatible, loadCheckpoint, saveCheckpoint } from '../src/search/checkpoint.js';
import { policyWinRate } from '../src/search/policy.js';
import { existsSync } from 'node:fs';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROUNDS = Number(arg('rounds', '4'));
const EPISODES = Number(arg('episodes', '6'));
const AZ_ITERS = Number(arg('azIters', '60'));
const EPOCHS = Number(arg('epochs', '80'));
const TEMP_MOVES = Number(arg('tempMoves', '8'));
const LR = Number(arg('lr', '0.01'));
const L2 = Number(arg('l2', '0.0001'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const OUT = arg('out', '.models/az.json');
const WARM = arg('warmFrom', '');
const DIFFICULTIES = arg('difficulties', '1.0,1.5').split(',').map(Number).filter((n) => n > 0);

// Build the encoder from the warm checkpoint's manifest (so vocab indices line up with the
// loaded net's weight columns), and assert compatibility — otherwise a drifted vocab would
// silently mis-map every input column. Cold start uses a fresh manifest.
const warmCk = WARM && existsSync(WARM) ? loadCheckpoint(WARM) : null;
const enc = createEncoder(content, warmCk?.manifest, { positionalHand: false });
let net: NetParams;
if (warmCk) {
  assertCompatible(warmCk, enc.manifest);
  net = warmCk.model as NetParams;
  console.log(`warm-started from ${WARM} (fp ${warmCk.fingerprint})`);
} else {
  const initRng = new Rng(seedFromString('az-init'));
  net = createNet({ inputSize: enc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => initRng.next());
  console.log('cold start (random net)');
}
const searchRng = (() => { const r = new Rng(seedFromString('az-search')); return () => r.next(); })();
const sampleRng = (() => { const r = new Rng(seedFromString('az-sample')); return () => r.next(); })();
const evalSeeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

function sampleSlot(visits: Float32Array): number {
  let tot = 0;
  for (const v of visits) tot += v;
  if (tot <= 0) return -1;
  let r = sampleRng() * tot;
  for (let i = 0; i < ACTION_SPACE; i++) {
    r -= visits[i] ?? 0;
    if (r <= 0) return i;
  }
  return -1;
}

const D: TrainSample[] = [];

for (let round = 0; round < ROUNDS; round++) {
  for (let e = 0; e < EPISODES; e++) {
    const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: DIFFICULTIES[(round * 7 + e) % DIFFICULTIES.length] ?? 1 };
    let s: RunState = createRun(content, `az-${round}-${e}`, config);
    const pending: Array<{ x: Float32Array; pi: Float32Array; mask: Float32Array }> = [];
    for (let step = 0; step < 6000 && s.phase !== 'victory' && s.phase !== 'defeat'; step++) {
      const res = azSearch(content, s, { iterations: AZ_ITERS, rand: searchRng, net, encoder: enc });
      const { mask, actions } = actionMask(content, s);
      let total = 0;
      for (const v of res.visits) total += v;
      if (total <= 0) break;
      const pi = new Float32Array(ACTION_SPACE);
      for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (res.visits[i] ?? 0) / total;
      pending.push({ x: enc.encode(s), pi, mask });
      // Sample early for exploration, argmax later.
      let played: GameAction = res.action;
      if (step < TEMP_MOVES) {
        const slot = sampleSlot(res.visits);
        if (slot >= 0 && actions[slot]) played = actions[slot] as GameAction;
      }
      s = applyAction(content, s, played);
    }
    const z = s.phase === 'victory' ? 1 : 0;
    for (const p of pending) D.push({ x: p.x, pi: p.pi, mask: p.mask, z });
  }

  let loss = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) loss = trainStep(net, D, LR, L2).loss;

  const base = policyWinRate(content, enc, net, DEFAULT_RUN_CONFIG, evalSeeds);
  const hard = policyWinRate(content, enc, net, { ...DEFAULT_RUN_CONFIG, enemyHpMult: 1.5 }, evalSeeds);
  console.log(
    `round ${round}: |D|=${D.length} loss=${loss.toFixed(4)} no-search base=${(base * 100).toFixed(1)}% hp1.5=${(hard * 100).toFixed(1)}%`,
  );
}

saveCheckpoint(OUT, enc.manifest, net);
console.log(`saved -> ${OUT}  (eval search strength with hybrid.ts)`);
