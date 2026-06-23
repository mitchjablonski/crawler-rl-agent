/**
 * Headless playtest harness (dev only — not shipped).
 *   npx tsx scripts/playtest.ts --runs=500 --policy=greedy --enemyhp=1.0 --maxhp=70
 * Emits JSON telemetry to stdout. The engine is pure, so this sweeps thousands
 * of full runs in seconds.
 */
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import {
  CHARACTERS,
  DEFAULT_RUN_CONFIG,
  content as baseContent,
} from '../src/engine/content/index.js';
import type {
  ContentRegistry,
  EnemyDef,
  GameAction,
  RunState,
} from '../src/engine/types.js';
import { EngineError } from '../src/engine/types.js';
import { mctsAction } from '../src/search/mcts.js';

type PolicyName = 'greedy' | 'cautious' | 'naive' | 'mcts';
type Policy = (state: RunState, content: ContentRegistry, rand: () => number) => GameAction;

const ACTION_CAP = 20_000;

// --- arg parsing ---
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const RUNS = Number(arg('runs', '500'));
const POLICY = arg('policy', 'greedy') as PolicyName;
const ENEMY_HP_MULT = Number(arg('enemyhp', '1'));
const MAX_HP = Number(arg('maxhp', String(DEFAULT_RUN_CONFIG.maxHp)));
const START_GOLD = Number(arg('gold', String(DEFAULT_RUN_CONFIG.startingGold)));
const TEMPO = Number(arg('tempo', '0.5'));
const SEED_BASE = arg('seedbase', 'play');
const ITERS = Number(arg('iters', '200'));
const MODE = arg('mode', 'single'); // 'single' | 'arc'
const ACTS = MODE === 'arc' ? 3 : 1;
const CHARACTER = arg('character', 'knight');
const charDef = CHARACTERS[CHARACTER] ?? CHARACTERS['knight']!;

// Tally of card plays across all runs (any policy) — surfaces which cards a
// strong agent actually leans on (note: dominated by starters via deck share).
const cardPlays: Record<string, number> = {};
// Draft pick-rate: how often an OFFERED reward card is taken — the clean
// dominant/dead-card signal.
const cardOffered: Record<string, number> = {};
const cardPicked: Record<string, number> = {};
let rewardsSeen = 0;
let rewardsSkipped = 0;

// --- deterministic per-run RNG for policy tie-breaks (kept out of engine streams) ---
function mulberry(seedStr: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- difficulty: scale enemy HP without touching shipped content ---
function scaleContent(content: ContentRegistry, mult: number): ContentRegistry {
  if (mult === 1) return content;
  const enemies: Record<string, EnemyDef> = {};
  for (const [id, def] of Object.entries(content.enemies)) {
    enemies[id] = {
      ...def,
      hp: [Math.max(1, Math.round(def.hp[0] * mult)), Math.max(1, Math.round(def.hp[1] * mult))],
    };
  }
  return { ...content, enemies };
}

// --- policies ---
function livingTarget(state: RunState, lowest: boolean): number | undefined {
  const enemies = state.combat?.enemies ?? [];
  let best = -1;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.hp <= 0) continue;
    if (best === -1) best = i;
    else {
      const cur = enemies[best] as { hp: number };
      if (lowest ? e.hp < cur.hp : e.hp > cur.hp) best = i;
    }
  }
  return best === -1 ? undefined : best;
}

function combatAction(
  state: RunState,
  content: ContentRegistry,
  prefer: 'attack' | 'block',
): GameAction {
  const combat = state.combat;
  if (!combat) throw new EngineError('no combat');
  const order = prefer === 'block' ? ['power', 'skill', 'attack'] : ['power', 'attack', 'skill'];
  for (const type of order) {
    for (let i = 0; i < combat.hand.length; i++) {
      const card = content.cards[combat.hand[i] as string];
      if (!card || card.type !== type || card.cost > combat.energy) continue;
      return {
        type: 'playCard',
        handIndex: i,
        targetIndex: card.target === 'enemy' ? livingTarget(state, true) : undefined,
      };
    }
  }
  return { type: 'endTurn' };
}

function navAction(state: RunState, hpFrac: number, rand: () => number): GameAction {
  const next = state.map.nodes[state.currentNodeId]?.next ?? [];
  if (next.length === 0) throw new EngineError('dead-end map node');
  const scored = next.map((id) => {
    const kind = state.map.nodes[id]?.kind;
    let score = rand() * 0.1;
    if (kind === 'rest' && hpFrac < 0.6) score += 2;
    if (kind === 'elite') score += hpFrac > 0.7 ? 0.5 : -2;
    if (kind === 'shop') score += 0.2;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { type: 'chooseNode', nodeId: (scored[0] as { id: string }).id };
}

function nonCombat(state: RunState, content: ContentRegistry, rand: () => number): GameAction {
  switch (state.phase) {
    case 'map':
      return navAction(state, state.hp / state.maxHp, rand);
    case 'reward':
      return state.reward?.cards.length
        ? { type: 'pickRewardCard', index: 0 }
        : { type: 'skipReward' };
    case 'shop': {
      const stock = state.shop?.stock ?? [];
      const i = stock.findIndex((s) => !s.sold && state.gold >= s.price + 20);
      return i >= 0 ? { type: 'buyCard', index: i } : { type: 'leaveShop' };
    }
    case 'rest':
      return { type: 'rest' };
    case 'event':
      return { type: 'chooseEventOption', index: 0 };
    default:
      throw new EngineError(`no non-combat action for phase ${state.phase}`);
  }
}

function act(
  state: RunState,
  content: ContentRegistry,
  rand: () => number,
  prefer: 'attack' | 'block',
): GameAction {
  if (state.phase === 'combat') return combatAction(state, content, prefer);
  return nonCombat(state, content, rand);
}

const POLICIES: Record<Exclude<PolicyName, 'mcts'>, Policy> = {
  greedy: (state, content, rand) => act(state, content, rand, 'attack'),
  cautious: (state, content, rand) => act(state, content, rand, 'block'),
  naive: (state, content, rand) => {
    if (state.phase === 'combat' && state.combat) {
      const combat = state.combat;
      const affordable: number[] = [];
      combat.hand.forEach((id, i) => {
        const c = content.cards[id];
        if (c && c.cost <= combat.energy) affordable.push(i);
      });
      if (affordable.length === 0 || rand() < 0.2) return { type: 'endTurn' };
      const handIndex = affordable[Math.floor(rand() * affordable.length)] as number;
      const card = content.cards[combat.hand[handIndex] as string];
      return {
        type: 'playCard',
        handIndex,
        targetIndex: card?.target === 'enemy' ? livingTarget(state, false) : undefined,
      };
    }
    return nonCombat(state, content, rand);
  },
};

// --- one run ---
interface RunResult {
  outcome: 'victory' | 'defeat';
  deathRow: number | null;
  deathNodeKind: string | null;
  deathEnemy: string | null;
  combatsEntered: number;
  endHp: number;
  deckSize: number;
  relics: number;
}

function playRun(seed: string, content: ContentRegistry, config: RunConfig, policy: Policy): RunResult {
  const rand = mulberry(seed);
  let state = createRun(content, seed, config);
  let combatsEntered = 0;
  let prevPhase = state.phase;
  let lastCombatEnemies: string[] = [];
  for (let i = 0; i < ACTION_CAP; i++) {
    if (state.phase === 'victory' || state.phase === 'defeat') break;
    if (state.phase === 'combat' && prevPhase !== 'combat') combatsEntered++;
    if (state.phase === 'combat' && state.combat) {
      lastCombatEnemies = state.combat.enemies.map((e) => e.defId);
    }
    prevPhase = state.phase;
    try {
      const action = policy(state, content, rand);
      if (action.type === 'playCard' && state.combat) {
        const id = state.combat.hand[action.handIndex];
        if (id) cardPlays[id] = (cardPlays[id] ?? 0) + 1;
      }
      if (state.phase === 'reward' && state.reward) {
        rewardsSeen++;
        for (const cid of state.reward.cards) cardOffered[cid] = (cardOffered[cid] ?? 0) + 1;
        if (action.type === 'pickRewardCard') {
          const cid = state.reward.cards[action.index];
          if (cid) cardPicked[cid] = (cardPicked[cid] ?? 0) + 1;
        } else if (action.type === 'skipReward') {
          rewardsSkipped++;
        }
      }
      state = applyAction(content, state, action);
    } catch (err) {
      if (err instanceof EngineError && state.phase === 'combat') {
        state = applyAction(content, state, { type: 'endTurn' });
      } else throw err;
    }
  }
  const node = state.map.nodes[state.currentNodeId];
  const defeated = state.phase === 'defeat';
  return {
    outcome: state.phase === 'victory' ? 'victory' : 'defeat',
    deathRow: defeated ? node?.row ?? null : null,
    deathNodeKind: defeated ? node?.kind ?? null : null,
    deathEnemy: defeated ? lastCombatEnemies.join('+') || null : null,
    combatsEntered,
    endHp: state.hp,
    deckSize: state.deck.length,
    relics: state.relics.length,
  };
}

// --- sweep ---
const content = scaleContent(baseContent, ENEMY_HP_MULT);
const config: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  starterDeck: charDef.starterDeck,
  startingRelics: charDef.startingRelics,
  maxHp: MAX_HP,
  startingGold: START_GOLD,
  tempoHint: TEMPO,
  acts: ACTS,
};
function resolvePolicy(): Policy {
  if (POLICY === 'mcts') {
    return (state, content_, rand) =>
      mctsAction(content_, state, {
        iterations: ITERS,
        rollout: (c, s, r) => POLICIES.greedy(s, c, r),
        rand,
      });
  }
  const p = POLICIES[POLICY];
  if (!p) throw new Error(`unknown policy ${POLICY}`);
  return p;
}
const policy = resolvePolicy();

const results: RunResult[] = [];
for (let i = 0; i < RUNS; i++) results.push(playRun(`${SEED_BASE}-${i}`, content, config, policy));

const wins = results.filter((r) => r.outcome === 'victory');
const deaths = results.filter((r) => r.outcome === 'defeat');
const tally = (key: (r: RunResult) => string | number | null) => {
  const m: Record<string, number> = {};
  for (const r of deaths) {
    const k = String(key(r));
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(
  JSON.stringify(
    {
      params: { runs: RUNS, policy: POLICY, mode: MODE, iters: POLICY === 'mcts' ? ITERS : undefined, enemyHpMult: ENEMY_HP_MULT, maxHp: MAX_HP, startGold: START_GOLD, tempo: TEMPO },
      winRate: +(wins.length / RUNS).toFixed(3),
      avgCombatsEntered: +avg(results.map((r) => r.combatsEntered)).toFixed(2),
      avgEndHpOnWin: +avg(wins.map((r) => r.endHp)).toFixed(1),
      avgDeckSize: +avg(results.map((r) => r.deckSize)).toFixed(1),
      avgRelics: +avg(results.map((r) => r.relics)).toFixed(2),
      deathsByRow: tally((r) => r.deathRow),
      deathsByNodeKind: tally((r) => r.deathNodeKind),
      deathsByEnemy: tally((r) => r.deathEnemy),
      topCardPlays: Object.fromEntries(
        Object.entries(cardPlays).sort((a, b) => b[1] - a[1]).slice(0, 12),
      ),
      rewardSkipRate: rewardsSeen ? +(rewardsSkipped / rewardsSeen).toFixed(3) : 0,
      pickRate: Object.fromEntries(
        Object.entries(cardOffered)
          .map(([id, off]) => [
            id,
            { offered: off, picked: cardPicked[id] ?? 0, rate: +((cardPicked[id] ?? 0) / off).toFixed(2) },
          ] as const)
          .sort((a, b) => b[1].rate - a[1].rate),
      ),
    },
    null,
    2,
  ),
);
