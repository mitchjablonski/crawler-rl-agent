/**
 * Experiment: train the attention-pooling entity net by behavioral cloning from
 * the MCTS expert (entity-tokenized, soft visit targets + graded value), then
 * measure its NO-SEARCH win rate against the flat-MLP baseline (~35-40%). Node-only.
 *
 *   npx tsx scripts/entityExp.ts --episodes=30 --mctsIters=160 --epochs=200 \
 *     --dModel=32 --hidden=64 --difficulties=1.0,1.5,2.0 --evalRuns=20
 */
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { GameAction, RunState } from '../src/engine/types.js';
import { TOKEN_TYPES, createEntityEncoder } from '../src/search/entityEncode.js';
import { ACTION_SPACE, actionMask } from '../src/search/mask.js';
import { mctsExpertSearch } from '../src/search/mctsExpert.js';
import {
  type EntityNetParams,
  type EntitySample,
  createEntityNet,
  predictEntity,
  trainStepEntity,
} from '../src/search/entityNet.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const EPISODES = Number(arg('episodes', '30'));
const MCTS_ITERS = Number(arg('mctsIters', '160'));
const EPOCHS = Number(arg('epochs', '200'));
const D_MODEL = Number(arg('dModel', '32'));
const HIDDEN = Number(arg('hidden', '64'));
const LR = Number(arg('lr', '0.02'));
const L2 = Number(arg('l2', '0.0001'));
const TEMP_MOVES = Number(arg('tempMoves', '8'));
const VALUE_BLEND = Number(arg('valueBlend', '0.5'));
const EVAL_RUNS = Number(arg('evalRuns', '20'));
const DIFFICULTIES = arg('difficulties', '1.0,1.5,2.0')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);

const enc = createEntityEncoder(content);
const initRng = new Rng(seedFromString('entity-init'));
const net: EntityNetParams = createEntityNet(
  {
    numTokenTypes: TOKEN_TYPES.length,
    idVocab: enc.idVocab,
    featDim: enc.featDim,
    actionSize: ACTION_SPACE,
    dModel: D_MODEL,
    hidden: HIDDEN,
  },
  () => initRng.next(),
);
const expertRng = (() => {
  const r = new Rng(seedFromString('entity-expert'));
  return () => r.next();
})();

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

function genEpisode(seed: string, config: RunConfig): EntitySample[] {
  let state: RunState = createRun(content, seed, config);
  const pending: Array<{ tokens: ReturnType<typeof enc.encode>; pi: Float32Array; mask: Float32Array; rootValue: number }> = [];
  for (let step = 0; step < 4000 && state.phase !== 'victory' && state.phase !== 'defeat'; step++) {
    const res = mctsExpertSearch(content, state, { iterations: MCTS_ITERS, rand: expertRng });
    const { mask, actions } = actionMask(content, state);
    let total = 0;
    for (const v of res.visits) total += v;
    const pi = new Float32Array(ACTION_SPACE);
    if (total > 0) for (let i = 0; i < ACTION_SPACE; i++) pi[i] = (res.visits[i] ?? 0) / total;
    pending.push({ tokens: enc.encode(state), pi, mask, rootValue: res.rootValue });
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
    .map((p) => ({ tokens: p.tokens, pi: p.pi, mask: p.mask, z: VALUE_BLEND * z + (1 - VALUE_BLEND) * p.rootValue }));
}

function entityPolicyAction(state: RunState): GameAction {
  const { mask, actions } = actionMask(content, state);
  const { policy } = predictEntity(net, enc.encode(state));
  let best = -1;
  let bestv = -Infinity;
  for (let i = 0; i < ACTION_SPACE; i++) {
    if ((mask[i] ?? 0) > 0 && (policy[i] ?? 0) > bestv) {
      bestv = policy[i] ?? 0;
      best = i;
    }
  }
  return (best >= 0 ? actions[best] : null) ?? actions.find((a): a is GameAction => a !== null) ?? { type: 'endTurn' };
}

function noSearchWinRate(seeds: string[]): number {
  let wins = 0;
  for (const seed of seeds) {
    let s: RunState = createRun(content, seed, DEFAULT_RUN_CONFIG);
    for (let i = 0; i < 4000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
      s = applyAction(content, s, entityPolicyAction(s));
    }
    if (s.phase === 'victory') wins++;
  }
  return wins / Math.max(1, seeds.length);
}

console.log(
  `entity-net: dModel=${D_MODEL} hidden=${HIDDEN} tokens<=${enc.maxTokens} idVocab=${enc.idVocab} ` +
    `| episodes=${EPISODES} mctsIters=${MCTS_ITERS} epochs=${EPOCHS} difficulties=[${DIFFICULTIES.join(',')}]`,
);

const data: EntitySample[] = [];
for (let e = 0; e < EPISODES; e++) {
  const enemyHpMult = DIFFICULTIES[e % DIFFICULTIES.length] ?? 1;
  data.push(...genEpisode(`entity-${e}`, { ...DEFAULT_RUN_CONFIG, enemyHpMult }));
}
console.log(`generated ${data.length} samples`);

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const stats = trainStepEntity(net, data, LR, L2);
  if (epoch % 25 === 0 || epoch === EPOCHS - 1) {
    console.log(`  epoch ${epoch}: loss=${stats.loss.toFixed(4)} (p=${stats.policyLoss.toFixed(4)} v=${stats.valueLoss.toFixed(4)})`);
  }
}

const seeds = Array.from({ length: EVAL_RUNS }, (_, i) => `eval-${i}`);
console.log(`entity-net NO-SEARCH win rate: ${(noSearchWinRate(seeds) * 100).toFixed(1)}%  (flat-MLP baseline ~35-40%)`);
