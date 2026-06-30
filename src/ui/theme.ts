/**
 * Central theme module: the single source of visual truth for the terminal UI.
 *
 * Every screen routes its colors through SEMANTIC tokens (not raw Ink color
 * names) so a future companion "art mirror" can map the same tokens to real
 * art. The canvas-side renderer (scripts/lib/termRender.ts) derives its
 * ANSI->hex table from `theme.palette`, so terminal and any future art share
 * one palette.
 *
 * Purity: this module is data-only. It type-imports from the engine but must
 * not import engine runtime, RNG, or the wall clock.
 */
import type { CardType, NodeKind, Rarity, Statuses, StatusId } from '../engine/types.js';

/**
 * The Ink color names the theme uses. Ink accepts any chalk ForegroundColorName
 * (plus hex strings); we constrain ourselves to this stable subset so the
 * canvas mirror can map every value to an ANSI SGR code.
 */
export type InkColor =
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'grey';

/**
 * Hex backing for each Ink color name. This is the canonical palette: the
 * terminal uses the Ink names, the canvas renderer derives pixels from these
 * hex values. Kept identical to the historical termRender palette so existing
 * snapshots/gif look the same.
 */
export const palette: Readonly<Record<InkColor, string>> = {
  red: '#ff6b6b',
  green: '#8bd55a',
  yellow: '#ffd166',
  blue: '#6ea8fe',
  magenta: '#d98cff',
  cyan: '#56d4d4',
  white: '#e6e6e6',
  grey: '#7a8290',
};

/** Foreground for uncolored text and the canvas background. */
export const defaultFg = '#cdd3de';
export const background = '#0b0e14';

/** Semantic color tokens -> Ink color names. */
const colors = {
  /** Screen titles, headings, primary "shiny" emphasis. */
  title: 'yellow',
  /** Player/enemy hit points. */
  hp: 'red',
  /**
   * #64 player-HP legibility gradient. The player's HP readout tints by current
   * fraction so a low-HP state is FELT at a glance (and, for the Overclocker,
   * the missing-HP that powers its cards reads as rising "heat"): a cool/healthy
   * end, a yellow warning band, then the red critical/redline alarm. Semantic
   * tokens (never raw Ink names at the call site); see {@link hpTint}.
   */
  hpHealthy: 'green',
  hpWarning: 'yellow',
  hpCritical: 'red',
  /**
   * #65 "powered/overheat" warm cue. Marks the Overclocker's missing-HP payoff
   * as INTENTIONAL (not just danger): the live gradient value on a hand card and
   * the HEAT chip both render in this warm tone so low HP reads as "powered up".
   * Semantic token (never a raw Ink name at the call site).
   */
  heat: 'yellow',
  /** Block / armor. */
  block: 'cyan',
  /** Energy. */
  energy: 'magenta',
  /** Currency. */
  gold: 'yellow',
  /** Positive outcome (victory, buff). */
  success: 'green',
  /** Negative outcome (defeat, debuff, danger). */
  danger: 'red',
  /** De-emphasized / secondary text (pairs with Ink dimColor too). */
  muted: 'grey',
  /** Generic accent for relics, statuses, secondary highlights. */
  accent: 'cyan',
  /** Card cost pip. */
  cardCost: 'magenta',
  /** Depleted/empty portion of an HP bar (the "missing" track). */
  hpEmpty: 'grey',
  /**
   * Per intent-category color for the enemy's telegraphed next move. Mirrors the
   * `intent` icon map below so a future art mirror can color the same glyphs.
   */
  intent: {
    attack: 'red',
    defend: 'cyan',
    buff: 'green',
    debuff: 'magenta',
    unknown: 'grey',
  } satisfies Record<IntentKind, InkColor>,
  /** Per node-kind label color (map). */
  nodeKind: {
    start: 'green',
    combat: 'white',
    elite: 'magenta',
    event: 'cyan',
    shop: 'yellow',
    rest: 'green',
    boss: 'red',
  } satisfies Record<NodeKind, InkColor>,
  /** Per-rarity color for card-frame names. */
  rarity: {
    starter: 'grey',
    common: 'white',
    uncommon: 'blue',
    rare: 'yellow',
  } satisfies Record<Rarity, InkColor>,
  /** Per card-type color for the card-frame type indicator. */
  cardType: {
    attack: 'red',
    skill: 'cyan',
    power: 'magenta',
  } satisfies Record<CardType, InkColor>,
} satisfies Record<string, InkColor | Record<string, InkColor>>;

/**
 * Semantic category for an enemy's telegraphed next move, derived from its
 * effects (attack = deals damage, defend = gains block, buff = buffs self,
 * debuff = applies a negative status to the player). Drives both icon and color
 * so terminal and a future art mirror read the same semantics.
 */
export type IntentKind = 'attack' | 'defend' | 'buff' | 'debuff' | 'unknown';

/** Plain-terminal-safe ASCII glyph per intent category (verified to render). */
export const intentIcons: Readonly<Record<IntentKind, string>> = {
  attack: '>>', // incoming strike
  defend: '[]', // raising guard
  buff: '^^', // empowering self
  debuff: 'vv', // weakening you
  unknown: '??',
};

/**
 * Fixed-width HP-bar glyphs. Deliberately ASCII (`#`/`-`): the snapshot canvas
 * renders one cell per character in a `monospace` font, and box-drawing blocks
 * (█/░) do not reliably align there, so we use characters guaranteed to render
 * and keep columns square. `width` is the fixed inner length of every bar.
 */
export const hpBar = {
  width: 10,
  full: '#',
  empty: '-',
} as const;

/** Display metadata for every status effect: short label, plain glyph, color. */
export interface StatusStyle {
  readonly label: string;
  /** Short glyph/letters that render in a plain terminal (ASCII-safe). */
  readonly icon: string;
  readonly color: InkColor;
}

const status: Readonly<Record<StatusId, StatusStyle>> = {
  strength: { label: 'strength', icon: 'STR', color: 'red' },
  dexterity: { label: 'dexterity', icon: 'DEX', color: 'green' },
  vulnerable: { label: 'vulnerable', icon: 'VUL', color: 'yellow' },
  weak: { label: 'weak', icon: 'WK', color: 'blue' },
  regen: { label: 'regen', icon: 'REG', color: 'green' },
  poison: { label: 'poison', icon: 'PSN', color: 'magenta' },
  // #68 overcharge: the Overclocker's overheat->Strength payoff power. Rendered in
  // the same warm tone as the `heat` token (the missing-HP "powered" cue) so the
  // overheat fantasy reads consistently. Compact `OVC` glyph keeps the HUD budget.
  overcharge: { label: 'overcharge', icon: 'OVC', color: colors.heat },
};

/** Shared layout constants. */
const layout = {
  /** Content/text wrap width used across screens (was a magic 76). */
  contentWidth: 76,
} as const;

/**
 * Letter hotkeys for the potion satchel, shared by CombatScreen and ShopScreen
 * so the same slot maps to the same letter everywhere. 'e' is deliberately
 * skipped because combat reserves it for end-turn.
 */
export const POTION_KEYS: readonly string[] = ['a', 'b', 'c', 'd', 'f', 'g'];

/**
 * Structural framing tokens. This is the SEAM for bordered panels (V2) and card
 * frames (V3): consumers should read border styles / divider glyphs from here
 * rather than hardcoding box-drawing. Defaults only — no screen draws borders
 * yet. `border` values match Ink's `<Box borderStyle>` names so they can be
 * passed straight through once panels land.
 */
const box = {
  /** Border style for generic bordered panels (Ink borderStyle name). */
  panel: 'round',
  /** Border style for emphasized/highlighted panels (e.g. selected card). */
  emphasis: 'double',
  /** Border color token name (key of `colors`-like semantic set). */
  borderColor: 'muted',
  /** Single-line horizontal divider glyph (plain-terminal safe). */
  divider: '-',
  /** Vertical separator glyph. */
  separator: '|',
} as const;

/**
 * Screen-chrome tokens (V2): the shared frame every screen renders through
 * (`components/Screen.tsx`). Centralizing the header/footer/spacing here keeps
 * all screens visually identical and makes the chrome tunable from one place.
 * Purely structural — colors still route through `colors`.
 */
const chrome = {
  /** Horizontal padding applied inside the frame (was a per-screen magic 1). */
  paddingX: 1,
  /** Blank rows between the header rule and the body, and the body and footer. */
  gap: 1,
  /** Color token for the screen-title header text. */
  titleColor: 'title',
  /** Color token for the footer key-hint line. */
  footerColor: 'muted',
  /** Border style for the framed (calm) screen variant. */
  borderStyle: 'round',
  /** Border color token for the framed variant. */
  borderColor: 'muted',
} as const;

export const theme = {
  colors,
  status,
  layout,
  box,
  chrome,
  palette,
  defaultFg,
  background,
  intentIcons,
  hpBar,
} as const;

export type Theme = typeof theme;
export type BoxTheme = typeof box;

/**
 * #64: the player HP readout's tint by current fraction. Pure & deterministic so
 * it is unit-testable without rendering. Thresholds: healthy above 50%, a warning
 * band from 50% down to 25%, critical at/under 25% (a universal low-HP alarm that
 * also makes the Overclocker's missing-HP gradient legible). Returns a SEMANTIC
 * color token (one of the `hp*` gradient tokens), never a raw Ink color name.
 */
export function hpTint(hp: number, maxHp: number): InkColor {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.5) return colors.hpHealthy;
  if (ratio > 0.25) return colors.hpWarning;
  return colors.hpCritical;
}

/**
 * Build a fixed-width HP bar split into its filled and empty runs. Pure: the
 * screen colors `filled` with `colors.hp` and `empty` with `colors.hpEmpty`.
 * Always exactly `hpBar.width` glyphs wide so columns stay aligned; a living
 * enemy keeps at least one filled glyph so it never reads as already dead.
 */
export function hpBarSegments(
  hp: number,
  maxHp: number,
): { readonly filled: string; readonly empty: string } {
  const w = hpBar.width;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  let fill = Math.round(ratio * w);
  if (hp > 0 && fill === 0) fill = 1; // alive => never fully empty
  if (hp < maxHp && fill === w) fill = w - 1; // hurt => never fully full
  return {
    filled: hpBar.full.repeat(fill),
    empty: hpBar.empty.repeat(w - fill),
  };
}

/**
 * The CANONICAL status glyph. This is the single source of truth for how a
 * status reads ANYWHERE in the combat UI — enemy status tags, the player's own
 * combat statuses, and the status portion of the enemy intent telegraph. Every
 * site routes through this so a status is identical everywhere:
 *   - COLOR is the status' IDENTITY color (`theme.status[id].color`) — STR is
 *     always red, VUL always yellow — never the threat-axis category color.
 *   - FORMAT is `<ICON> <N>` with a single space (e.g. `VUL 2`, `STR 1`).
 *     Pass `sign: true` for a leading `+` on the count (e.g. `STR +1`) to mark
 *     a value the holder GAINS (an enemy buffing itself in its telegraph); the
 *     icon/color are unchanged so it still reads as the same status.
 *
 * Pure presentational: returns data, the caller decides how to draw it.
 */
export function statusChip(
  id: StatusId,
  stacks: number,
  opts?: { readonly sign?: boolean },
): { readonly icon: string; readonly text: string; readonly color: InkColor } {
  const style = status[id];
  const count = opts?.sign ? `+${stacks}` : `${stacks}`;
  // `icon` is returned separately from `text` as a deliberate seam: terminal
  // callers draw `text`, but a future art mirror can map the bare `icon` to a
  // real status sprite. Keep it even though no current caller reads it alone.
  return { icon: style.icon, text: `${style.icon} ${count}`, color: style.color };
}

/**
 * Render an engine `Statuses` map into compact token-styled segments via the
 * canonical {@link statusChip}. Dumb presentational helper: returns data, the
 * screen decides how to draw it.
 */
export function statusSegments(
  statuses: Statuses,
): readonly { readonly text: string; readonly color: InkColor }[] {
  return (Object.entries(statuses) as [StatusId, number | undefined][])
    .filter(([, v]) => v !== undefined)
    .map(([id, v]) => {
      const chip = statusChip(id, v as number);
      return { text: chip.text, color: chip.color };
    });
}
