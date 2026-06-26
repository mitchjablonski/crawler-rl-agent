/**
 * visual-snapshot: render every game screen to a PNG so the visual-consistency
 * reviewer judges pixels, not prose. Autoplays a run per seed (different seeds
 * surface different node types — shop, rest, event, elite) and snapshots the
 * first time each screen appears.
 *
 *   npx tsx scripts/visual-snapshot.ts [--out=DIR] [--seeds=a,b,c] [--mode=single] [--character=knight] [--difficulty=normal]
 */
import './lib/forceColor.js'; // must be first: set FORCE_COLOR before ink/chalk load
import fs from 'node:fs';
import path from 'node:path';
import { startApp, autoPlay } from './lib/playHarness.js';
import { frameToPng } from './lib/termRender.js';
import type { Difficulty, RunMode } from '../src/config.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const OUT = arg('out', process.env.EVOLUTION_OUT ?? '.evolution-artifacts/snapshots');
// Broad default seed sweep: more seeds raise the odds of surfacing the rarer
// node types (shop, elite, boss) since each seed walks a different map.
const SEEDS = arg(
  'seeds',
  'demo,verify,atlas,gloom,ember,forge,vault,relic,abyss,spire,crypt,hoard',
)
  .split(',')
  .filter(Boolean);
const MODE = arg('mode', 'single') as RunMode;
const CHARACTER = arg('character', 'knight');
const DIFFICULTY = arg('difficulty', 'normal') as Difficulty;

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const written: string[] = [];
  const phasesSeen = new Set<string>();

  for (const seed of SEEDS) {
    const h = await startApp({
      seed,
      runMode: MODE,
      character: CHARACTER,
      difficulty: DIFFICULTY,
      // Seed the satchel so the combat snapshot actually renders the potion
      // line (snapshot harness only — game defaults untouched).
      startingPotions: ['fire-flask', 'iron-tonic'],
    });
    try {
      await autoPlay(h, {
        onSnapshot: async (phase, raw) => {
          // One file per phase across the whole sweep; first seed to reach a
          // screen wins, so we don't overwrite with near-identical frames.
          if (phasesSeen.has(phase)) return;
          phasesSeen.add(phase);
          const file = path.join(OUT, `${phase}.png`);
          fs.writeFileSync(file, await frameToPng(raw));
          written.push(file);
        },
      });
    } finally {
      h.unmount();
    }
  }

  process.stderr.write(
    `\nvisual-snapshot: ${written.length} screens -> ${OUT}\n` +
      `  captured: ${[...phasesSeen].join(', ')}\n`,
  );
  process.stdout.write(JSON.stringify({ out: OUT, screens: [...phasesSeen], files: written }, null, 2) + '\n');
}

void main();
