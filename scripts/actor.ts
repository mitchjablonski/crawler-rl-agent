/**
 * Self-play actor for the Node-actor / Python-learner loop (see learner/PROTOCOL.md).
 *
 * Publishes meta.json, then each round: loads the learner's latest weights (if any),
 * self-plays with PUCT, and appends encoded (x, pi, mask, z) samples to the replay dir.
 * Run alongside `python learner/train.py --exchange .az --watch`.
 *
 *   npx tsx scripts/actor.ts --exchange=.az --rounds=50 --episodes=12 --iters=48 [--positional=false]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng, seedFromString } from '../src/engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import { createEncoder } from '../src/search/encode.js';
import { ACTION_SPACE } from '../src/search/mask.js';
import { DEFAULT_HIDDEN, type NetParams, createNet } from '../src/search/net.js';
import { assertCompatible, loadCheckpoint } from '../src/search/checkpoint.js';
import { type SelfPlayOptions, selfPlayEpisode } from '../src/search/train.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const EXCHANGE = arg('exchange', '.az');
const ROUNDS = Number(arg('rounds', '50'));
const EPISODES = Number(arg('episodes', '12'));
const ITERS = Number(arg('iters', '48'));
const HIDDEN = Number(arg('hidden', String(DEFAULT_HIDDEN)));
const POSITIONAL = arg('positional', 'true') !== 'false';

const replayDir = join(EXCHANGE, 'replay');
const weightsLatest = join(EXCHANGE, 'weights', 'latest.json');
mkdirSync(replayDir, { recursive: true });
mkdirSync(join(EXCHANGE, 'weights'), { recursive: true });

const encoder = createEncoder(content, undefined, { positionalHand: POSITIONAL });

// Publish meta so the learner can size its net and stamp checkpoints with our manifest.
writeFileSync(
  join(EXCHANGE, 'meta.json'),
  JSON.stringify(
    {
      inputSize: encoder.size,
      actionSize: ACTION_SPACE,
      hidden: HIDDEN,
      manifest: encoder.manifest,
      fingerprint: encoder.fingerprint,
    },
    null,
    2,
  ),
);

const initRng = new Rng(seedFromString('actor-init'));
let net: NetParams = createNet(
  { inputSize: encoder.size, actionSize: ACTION_SPACE, hidden: HIDDEN },
  () => initRng.next(),
);

function loadLatestWeights(): NetParams | null {
  if (!existsSync(weightsLatest)) return null;
  try {
    const ckpt = loadCheckpoint(weightsLatest);
    assertCompatible(ckpt, encoder.manifest);
    return ckpt.model as NetParams;
  } catch (err) {
    console.error('skipping incompatible learner weights:', (err as Error).message);
    return null;
  }
}

const searchRng = (() => {
  const r = new Rng(seedFromString('actor-search'));
  return () => r.next();
})();

console.log(
  `actor: exchange=${EXCHANGE} encoder=${encoder.size} actions=${ACTION_SPACE} fp=${encoder.fingerprint}`,
);

for (let round = 0; round < ROUNDS; round++) {
  const latest = loadLatestWeights();
  if (latest) net = latest;
  const opts: SelfPlayOptions = {
    content,
    encoder,
    net,
    config: DEFAULT_RUN_CONFIG,
    searchIterations: ITERS,
    rand: searchRng,
  };
  const lines: string[] = [];
  let wins = 0;
  for (let e = 0; e < EPISODES; e++) {
    const samples = selfPlayEpisode(`actor-${round}-${e}`, opts);
    if (samples.length > 0 && samples[0]?.z === 1) wins++;
    for (const s of samples) {
      lines.push(
        JSON.stringify({
          x: Array.from(s.x),
          pi: Array.from(s.pi),
          mask: Array.from(s.mask),
          z: s.z,
        }),
      );
    }
  }
  const out = join(replayDir, `round-${String(round).padStart(4, '0')}.jsonl`);
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(
    `round ${round}: ${lines.length} samples, wins ${wins}/${EPISODES}, ` +
      `learnerWeights=${latest ? 'yes' : 'no'} -> ${out}`,
  );
}
