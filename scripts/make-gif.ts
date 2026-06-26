/**
 * Generate docs/demo.gif by driving the real App through ink-testing-library,
 * capturing terminal frames, and encoding them with gifenc. Shares the frame
 * renderer + harness seams with play-verify/visual-snapshot. Dev tool, not shipped.
 *   npm run gif
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import gifenc from 'gifenc';
import { App } from '../src/ui/App.js';
import { memoryStore, makeSource, staticAi, hook, tick } from './lib/playHarness.js';
import { frameToRgba, W, H } from './lib/termRender.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

async function main(): Promise<void> {
  const store = memoryStore();
  const src = makeSource();
  const { lastFrame, stdin } = render(
    React.createElement(App, {
      deps: { store, seed: 'demo', createSource: src.createSource, ai: staticAi, now: () => 0 },
    }),
  );
  await tick(40);

  const frames: { frame: string; hold: number }[] = [];
  const snap = (hold = 1400) => frames.push({ frame: lastFrame() ?? '', hold });

  snap(2200); // title (modes / class / difficulty / snark)
  stdin.write('n');
  await tick(40);
  snap(1700); // map: choose your path
  stdin.write('v');
  await tick(40);
  snap(2000); // deck view: per-card effect descriptions
  stdin.write('\x1b');
  await tick(40);
  stdin.write('1');
  await tick(40);
  snap(1900); // combat: framed hand + relics/pile HUD + enemy intent
  stdin.write('1');
  await tick(40);
  snap(1500); // after playing a card (energy/enemy change)
  src.emit(
    hook('PostToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { exitCode: 0 },
    }),
  );
  await tick(40);
  snap(2200); // dungeon: linked + narration + gold from the passing test
  src.emit(hook('Stop'));
  await tick(40);
  snap(2600); // CLAUDE AWAITS YOUR COMMAND — return to the surface

  const gif = GIFEncoder();
  for (const { frame, hold } of frames) {
    const rgba = frameToRgba(frame);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay: hold });
  }
  gif.finish();
  const out = path.join('docs', 'demo.gif');
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(out, gif.bytes());
  console.log(`wrote ${out} (${frames.length} frames, ${W}x${H}, ${gif.bytes().length} bytes)`);
  process.exit(0);
}

void main();
