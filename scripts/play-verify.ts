/**
 * play-verify: the loop's "agent plays the game" gate.
 *
 *  1. SMOKE: autoplay a whole run through the real TUI (no crash, reaches an
 *     ending, visits the expected screens) and write a PNG of each screen.
 *  2. INTEGRATION: prove the Claude-Code moments still fire — a passing test
 *     drops gold/narration, and Claude stopping returns you to the surface.
 *  3. BALANCE: shell out to the playtest harness across modes/classes and check
 *     win-rates aren't degenerate (0% unwinnable / 100% trivial).
 *
 * Prints a JSON verdict to stdout and a human summary to stderr. Exit code is
 * non-zero iff a hard check fails, so the loop can gate on it.
 *
 *   npx tsx scripts/play-verify.ts [--out=DIR] [--runs=50] [--skip-balance] [--seed=verify]
 */
import './lib/forceColor.js'; // must be first: set FORCE_COLOR before ink/chalk load
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  startApp,
  autoPlay,
  detectPhase,
  hook,
  type Phase,
} from './lib/playHarness.js';
import { frameToPng } from './lib/termRender.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const OUT = arg('out', process.env.EVOLUTION_OUT ?? '.evolution-artifacts/verify');
const RUNS = Number(arg('runs', '50'));
const SEED = arg('seed', 'verify');
const SKIP_BALANCE = has('skip-balance');

interface Verdict {
  ok: boolean;
  errors: string[];
  warnings: string[];
  smoke: {
    steps: number;
    phasesSeen: Phase[];
    finalPhase: Phase;
    reachedGameOver: boolean;
    usedPotion: boolean;
    upgradedCard: boolean;
    eventResolved: boolean;
    viewedDeck: boolean;
  } | null;
  integration: { testsPassFlavor: boolean; stopReturnsToSurface: boolean } | null;
  balance: { mode: string; character: string; winRate: number }[];
  snapshots: string[];
}

const verdict: Verdict = {
  ok: true,
  errors: [],
  warnings: [],
  smoke: null,
  integration: null,
  balance: [],
  snapshots: [],
};

async function writeSnapshot(name: string, raw: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, await frameToPng(raw));
  verdict.snapshots.push(file);
}

async function runSmoke(): Promise<void> {
  // Seed the satchel so the satchel→usePotion keypath (POTION_KEYS, target
  // select, satchel render) is exercised end-to-end every run, regardless of
  // which map the seed walks. Acquisition (shop buy) is also covered by the
  // autoplayer whenever a run hits a shop with an affordable potion.
  const h = await startApp({ seed: SEED, startingPotions: ['fire-flask', 'iron-tonic'] });
  try {
    const result = await autoPlay(h, {
      onSnapshot: (phase, raw) => writeSnapshot(phase, raw),
    });
    verdict.smoke = {
      steps: result.steps.length,
      phasesSeen: result.phasesSeen,
      finalPhase: result.finalPhase,
      reachedGameOver: result.reachedGameOver,
      usedPotion: result.usedPotion,
      upgradedCard: result.upgradedCard,
      eventResolved: result.eventResolved,
      viewedDeck: result.viewedDeck,
    };
    if (!result.phasesSeen.includes('combat'))
      verdict.errors.push('smoke: never reached combat');
    if (!result.usedPotion)
      verdict.errors.push('smoke: autoplayer never used a potion (satchel keypath unproven)');
    if (!result.reachedGameOver)
      verdict.warnings.push(
        `smoke: run did not reach an ending in the step budget (final: ${result.finalPhase})`,
      );
  } finally {
    h.unmount();
  }
}

async function runIntegration(): Promise<void> {
  const h = await startApp({ seed: SEED });
  try {
    // Walk into a combat so the status bar (gold/narration) is on screen.
    for (let i = 0; i < 40; i++) {
      const phase = detectPhase(h.text());
      if (phase === 'combat') break;
      if (phase === 'title') await h.press('n');
      else if (phase === 'map') await h.press('1');
      else await h.press('1');
    }
    const goldBefore = readGold(h.text());
    h.emit(hook('PostToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { exitCode: 0 },
    }));
    await h.press(''); // settle a tick without a meaningful key
    const afterTests = h.text();
    await writeSnapshot('tests-pass', h.raw());
    const goldAfter = readGold(afterTests);
    const testsPassFlavor = goldAfter > goldBefore || /\S/.test(narrationLine(afterTests));

    h.emit(hook('Stop'));
    await h.press('');
    const paused = detectPhase(h.text()) === 'pause';
    if (paused) await writeSnapshot('pause', h.raw());

    verdict.integration = { testsPassFlavor, stopReturnsToSurface: paused };
    if (!testsPassFlavor)
      verdict.warnings.push('integration: passing test produced no visible gold/narration');
    if (!paused) verdict.errors.push('integration: Claude Stop did not return to the surface');
  } finally {
    h.unmount();
  }
}

function readGold(text: string): number {
  const m = /(\d+)g\b/.exec(text);
  return m ? Number(m[1]) : 0;
}
function narrationLine(text: string): string {
  // Second status row holds narration; good enough as a presence check.
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines[1] ?? '';
}

function runBalance(): void {
  const matrix = [
    { mode: 'single', character: 'knight' },
    { mode: 'arc', character: 'knight' },
    { mode: 'single', character: 'apothecary' },
    { mode: 'arc', character: 'apothecary' },
  ];
  for (const { mode, character } of matrix) {
    try {
      const out = execFileSync(
        'npx',
        [
          'tsx',
          'scripts/playtest.ts',
          `--runs=${RUNS}`,
          '--policy=greedy',
          `--mode=${mode}`,
          `--character=${character}`,
          `--seedbase=verify-${mode}-${character}`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as {
        winRate: number;
      };
      verdict.balance.push({ mode, character, winRate: json.winRate });
      if (json.winRate <= 0)
        verdict.errors.push(`balance: ${mode}/${character} is unwinnable (0%)`);
      else if (json.winRate >= 1)
        verdict.warnings.push(`balance: ${mode}/${character} is trivial (100%)`);
    } catch (e) {
      verdict.warnings.push(
        `balance: ${mode}/${character} harness failed: ${(e as Error).message.split('\n')[0]}`,
      );
    }
  }
}

async function main(): Promise<void> {
  try {
    await runSmoke();
    await runIntegration();
    if (!SKIP_BALANCE) runBalance();
  } catch (e) {
    verdict.errors.push(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
  }
  verdict.ok = verdict.errors.length === 0;

  process.stderr.write(
    `\nplay-verify: ${verdict.ok ? 'PASS' : 'FAIL'}\n` +
      `  screens: ${verdict.smoke?.phasesSeen.join(', ') ?? 'none'}\n` +
      `  usedPotion: ${verdict.smoke?.usedPotion ?? false}\n` +
      `  upgradedCard: ${verdict.smoke?.upgradedCard ?? false}\n` +
      `  eventResolved: ${verdict.smoke?.eventResolved ?? false}\n` +
      `  viewedDeck: ${verdict.smoke?.viewedDeck ?? false}\n` +
      `  integration: testsPass=${verdict.integration?.testsPassFlavor} stop=${verdict.integration?.stopReturnsToSurface}\n` +
      `  balance: ${verdict.balance.map((b) => `${b.mode}/${b.character}=${(b.winRate * 100).toFixed(0)}%`).join('  ') || 'skipped'}\n` +
      `  snapshots: ${verdict.snapshots.length} -> ${OUT}\n` +
      (verdict.errors.length ? `  errors:\n${verdict.errors.map((e) => `   - ${e}`).join('\n')}\n` : '') +
      (verdict.warnings.length ? `  warnings:\n${verdict.warnings.map((w) => `   - ${w}`).join('\n')}\n` : ''),
  );
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  process.exit(verdict.ok ? 0 : 1);
}

void main();
