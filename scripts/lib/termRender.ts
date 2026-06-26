/**
 * Shared terminal-frame renderer: turns an ANSI terminal frame (as produced by
 * ink-testing-library's lastFrame()) into a pixel image. Used by make-gif.ts,
 * visual-snapshot.ts, and play-verify.ts so every tool draws the game the same
 * way. Dev-only tooling, not shipped in the package.
 *
 * The COLORS map is the canvas-side mirror of the game's palette. When the
 * theme module lands, this should derive from it so there is a single source of
 * visual truth across the terminal and any future art mirror.
 */
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import {
  background,
  defaultFg,
  palette,
  type InkColor,
} from '../../src/ui/theme.js';

/**
 * Ink color name -> ANSI SGR foreground code (what Ink/chalk emits). Must stay
 * in lockstep with `theme.palette` in src/ui/theme.ts: every InkColor needs an
 * SGR code here (the `Record<InkColor, number>` type enforces full coverage, so
 * adding a palette color will fail the build until its SGR code is added here).
 */
const INK_TO_SGR: Record<InkColor, number> = {
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  grey: 90,
};

/**
 * ANSI SGR foreground code -> hex, DERIVED from the theme palette so the
 * canvas renderer and the terminal UI share one source of visual truth.
 */
export const COLORS: Record<number, string> = {
  ...Object.fromEntries(
    (Object.entries(palette) as [InkColor, string][]).map(([name, hex]) => [
      INK_TO_SGR[name],
      hex,
    ]),
  ),
  39: defaultFg, // default foreground
};

export const DEFAULT_FG = defaultFg;
export const BG = background;

export const CELL_W = 9;
export const CELL_H = 19;
export const COLS = 76;
// Tall enough that framed screens (e.g. a full hand of bordered card tiles)
// aren't clipped in snapshots; the demo gif crops naturally to its content.
export const ROWS = 30;
export const PAD = 10;
export const W = COLS * CELL_W + PAD * 2;
export const H = ROWS * CELL_H + PAD * 2;

export interface Span {
  text: string;
  color: string;
  dim: boolean;
  bold: boolean;
}

/** Split one ANSI-coded line into colored spans. */
export function parseLine(line: string): Span[] {
  const spans: Span[] = [];
  let color = DEFAULT_FG;
  let dim = false;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string) => {
    if (text) spans.push({ text, color, dim, bold });
  };
  while ((m = re.exec(line)) !== null) {
    push(line.slice(last, m.index));
    last = re.lastIndex;
    for (const codeStr of (m[1] ?? '').split(';')) {
      const code = Number(codeStr || '0');
      if (code === 0) {
        color = DEFAULT_FG;
        dim = false;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        dim = false;
        bold = false;
      } else if (COLORS[code]) color = COLORS[code]!;
    }
  }
  push(line.slice(last));
  return spans;
}

/** Draw a terminal frame string onto a fresh canvas. */
export function frameToCanvas(frame: string): Canvas {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  const lines = frame.split('\n').slice(0, ROWS);
  lines.forEach((line, row) => {
    let col = 0;
    for (const span of parseLine(line)) {
      ctx.globalAlpha = span.dim ? 0.55 : 1;
      ctx.font = `${span.bold ? 'bold ' : ''}15px monospace`;
      ctx.fillStyle = span.color;
      for (const ch of span.text) {
        if (ch !== ' ') ctx.fillText(ch, PAD + col * CELL_W, PAD + row * CELL_H);
        col++;
      }
    }
  });
  ctx.globalAlpha = 1;
  return canvas;
}

/** RGBA bytes for a frame (used by the GIF encoder). */
export function frameToRgba(frame: string): Uint8ClampedArray {
  const canvas = frameToCanvas(frame);
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, W, H).data as unknown as Uint8ClampedArray;
}

/** PNG buffer for a frame (used for visual snapshots). */
export async function frameToPng(frame: string): Promise<Buffer> {
  return frameToCanvas(frame).encode('png');
}
