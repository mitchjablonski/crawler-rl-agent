/**
 * Multi-seed architecture sweep: across K trials (fresh expert data + fresh net
 * init each), train a flat MLP and the attention net on the SAME data and record
 * each one's no-search win rate. Reports the distribution so the architecture
 * claim rests on variance, not one lucky seed.
 *
 *   npx tsx scripts/abSweep.ts --trials=5 --episodes=20 --mctsIters=120 \
 *     --epochs=150 --dModel=32 --hidden=64 --evalRuns=30
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { TOKEN_TYPES, type Token, createEntityEncoder } from '../src/search/entityEncode.js';
import { ACTION_SPACE, actionMask } from '../src/search/mask.js';
import { mctsExpertSearch } from '../src/search/mctsExpert.js';
import { type TrainSample, createNet, trainStep } from '../src/search/net.js';
import {
  type EntityNetParams,
  type EntitySample,
  createEntityNet,
  predictEntity,
  trainStepEntity,
} from '../src/search/entityNet.js';
import { policyWinRate } from '../src/search/policy.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const TRIALS = Number(arg('trials', '5'));
const EPISODES = Number(arg('episodes', '20'));
const MCTS_ITERS = Number(arg('mctsIters', '120'));
const EPOCHS = Number(arg('epochs', '150'));
const D_MODEL = Number(arg('dModel', '32'));
const HIDDEN = Number(arg('hidden', '64'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const TEMP_MOVES = Number(arg('tempMoves', '8'));
const VALUE_BLEND = Number(arg('valueBlend', '0.5'));
const EVAL_RUNS = Number(arg('evalRuns', '30'));
const DIFFICULTIES = [1.0, 1.5, 2.0];

const flatEnc = createEncoder(content, undefined, { positionalHand: false });
const entEnc = createEntityEncoder(content);
const seeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);

function sampleSlot(visits: Float32Array, rand: () => number): number {
  let tot = 0;
  for (const v of visits) tot += v;
  if (tot <= 0) return -1;
  let r = rand() * tot;
  for (let i = 0; i < visits.length; i++) {
    r -= visits[i] ?? 0;
    if (r <= 0) return i;
  }
  return -1;
}

interface Row {
  flatX: Float32Array;
  tokens: Token[];
  pi: Float32Array;
  mask: Float32Array;
  z: number;
}

function genEpisode(seed: string, config: RunConfig, expertRng: () => number): Row[] {
  let state: RunState = createRun(content, seed, config);
  const pending: Array<{ flatX: Float32Array; tokens: Token[]; pi: Float32Array; mask: Float32Array; rootValue: number }> = [];
  for (let step = 0; step < 4000 && state.phase !== 'victory' && state.phase !== 'defeat'; step++) {
    const res = mctsExpertSearch(content, state, { iterations: MCTS_ITERS, rand: expertRng });
    const { mask, actions } = actionMask(content, state);
    let total = 0;
    for (const v of res.visits) total += v;
    const pi = new Float32Array(ACTION_SPACE);
    if (total > 0) for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (res.visits[i] ?? 0) / total;
    pending.push({ flatX: flatEnc.encode(state), tokens: entEnc.encode(state), pi, mask, rootValue: res.rootValue });
    let played: GameAction = res.action;
    if (step < TEMP_MOVES && total > 0) {
      const slot = sampleSlot(res.visits, expertRng);
      const s = slot >= 0 ? actions[slot] : null;
      if (s) played = s;
    }
    state = applyAction(content, state, played);
  }
  const z = state.phase === 'victory' ? 1 : 0;
  return pending
    .filter((p) => p.pi.some((x) => x > 0))
    .map((p) => ({ flatX: p.flatX, tokens: p.tokens, pi: p.pi, mask: p.mask, z: VALUE_BLEND * z + (1 - VALUE_BLEND) * p.rootValue }));
}

function entityWinRate(net: EntityNetParams): number {
  let wins = 0;
  for (const seed of seeds) {
    let s: RunState = createRun(content, seed, DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      const { mask, actions } = actionMask(content, s);
      const { policy } = predictEntity(net, entEnc.encode(s));
      let best = -1;
      let bv = -Infinity;
      for (let j = 0; j < ACTION_SPACE; j++) if ((mask[j] ?? 0) > 0 && (policy[j] ?? 0) > bv) { bv = policy[j] ?? 0; best = j; }
      const a = (best >= 0 ? actions[best] : null) ?? actions.find((x): x is GameAction => x !== null) ?? { type: 'endTurn' };
      s = applyAction(content, s, a);
    }
    if (s.phase === 'victory') wins++;
  }
  return wins / seeds.length;
}

const stats = (xs: number[]): string => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return `mean=${(mean * 100).toFixed(1)}% sd=${(sd * 100).toFixed(1)} min=${(Math.min(...xs) * 100).toFixed(0)}% max=${(Math.max(...xs) * 100).toFixed(0)}%`;
};

const mlpWins: number[] = [];
const entWins: number[] = [];
for (let t = 0; t < TRIALS; t++) {
  const expertRng = (() => {
    const r = new Rng(seedFromString(`sweep-expert-${t}`));
    return () => r.next();
  })();
  const rows: Row[] = [];
  for (let e = 0; e < EPISODES; e++) {
    const enemyHpMult = DIFFICULTIES[e % DIFFICULTIES.length] ?? 1;
    rows.push(...genEpisode(`sweep-${t}-${e}`, { ...DEFAULT_RUN_CONFIG, enemyHpMult }, expertRng));
  }
  const mlpData: TrainSample[] = rows.map((r) => ({ x: r.flatX, pi: r.pi, mask: r.mask, z: r.z }));
  const entData: EntitySample[] = rows.map((r) => ({ tokens: r.tokens, pi: r.pi, mask: r.mask, z: r.z }));

  const mlpInit = new Rng(seedFromString(`sweep-mlp-${t}`));
  const mlp = createNet({ inputSize: flatEnc.size, actionSize: ACTION_SPACE, hidden: HIDDEN }, () => mlpInit.next());
  const entInit = new Rng(seedFromString(`sweep-ent-${t}`));
  const ent = createEntityNet(
    { numTokenTypes: TOKEN_TYPES.length, idVocab: entEnc.idVocab, featDim: entEnc.featDim, actionSize: ACTION_SPACE, dModel: D_MODEL, hidden: HIDDEN },
    () => entInit.next(),
  );
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    trainStep(mlp, mlpData, LR, L2);
    trainStepEntity(ent, entData, LR, L2);
  }
  const mw = policyWinRate(content, flatEnc, mlp, DEFAULT_RUN_CONFIG, seeds);
  const ew = entityWinRate(ent);
  mlpWins.push(mw);
  entWins.push(ew);
  console.log(`trial ${t}: samples=${rows.length} flatMLP=${(mw * 100).toFixed(1)}% attention=${(ew * 100).toFixed(1)}%`);
}

console.log(`\n=== ${TRIALS}-trial no-search win rate (eval ${EVAL_RUNS} seeds) ===`);
console.log(`flat MLP:       ${stats(mlpWins)}`);
console.log(`attention net:  ${stats(entWins)}`);
