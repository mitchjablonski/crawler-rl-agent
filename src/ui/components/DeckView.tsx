import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CardType, ContentRegistry, Rarity, RunState } from '../../engine/types.js';
import type { InkColor } from '../theme.js';
import { theme } from '../theme.js';
import { Screen } from './Screen.js';

/**
 * Read-only overlay listing the player's deck. Opens from the MAP (whole-deck,
 * grouped) and from COMBAT (#56 — grouped by PILE so the player can answer "is
 * that card still coming in the draw pile?" mid-fight).
 *
 * A deckbuilder player plans upgrade/shop choices from the map phase, so the
 * deck view must show what each card DOES, not just its name. Each grouped row
 * is therefore TWO lines: the compact `(cost) Name [+]  pile type  xN` header
 * and a dim, single-line (truncated) effect description under it.
 *
 * Combat mode (#56): when opened during combat we read `combat.hand` /
 * `drawPile` / `discardPile` instead of `state.deck`. The title carries a pile
 * summary (`draw N | hand N | discard N`) and every row is tagged + GROUPED by its
 * pile (hand, then draw, then discard) so the listing reads as "what's where".
 * The draw pile is shown UNORDERED (it is shuffled) so this leaks no next-card
 * order. Read-only: opening it dispatches no combat action.
 *
 * Row budget (the #30 lesson): a deck can run 15-25+ cards and a two-line entry
 * DOUBLES the per-card height, so a full deck would overflow the 30-row snapshot
 * canvas. We therefore render a single column and PAGINATE: `PER_PAGE` entries
 * per page (see its note) so a FULL page + header/divider/footer stays <=30
 * rows. Descriptions are truncated to one line so a row never wraps and inflates
 * the count. Pages flip with [n]/[p]; identical ids still collapse to one `xN`
 * row (per pile in combat), and `[esc]/[v]` close. Upgraded (`-plus`) cards keep
 * the `[+]`; cards that still have a reachable upgrade get an accent `^` marker
 * (#44) so the deck view shows WHICH cards the rest site's "(N upgradeable)"
 * count refers to. The marker is inline (adds no rows) so the page row budget is
 * untouched.
 *
 * Purely presentational: it holds no game actions and dispatches nothing. It is
 * an App-local UI overlay (like the pause overlay), NOT an engine phase.
 */

/** Type sort order matches how a player reasons about a deck: hit, defend, scale. */
const TYPE_ORDER: Readonly<Record<CardType, number>> = { attack: 0, skill: 1, power: 2 };
/** Rarity sort order: cheap/common first, shiny last. */
const RARITY_ORDER: Readonly<Record<Rarity, number>> = {
  starter: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
};

/**
 * Entries per page. Each entry is 2 rows (header + description). The unframed
 * Screen spends 5 rows on chrome (title + divider + gap + gap + footer), so a
 * full page must keep `PER_PAGE * 2 + 5 <= 30` => PER_PAGE <= 12. Twelve gives
 * 24 body rows + 5 chrome = 29 rows, comfortably under the budget even for a
 * 20+ card deck (which simply spans more pages).
 */
const PER_PAGE = 12;

/** Inner text width of the unframed Screen (contentWidth - paddingX*2). */
const DESC_WIDTH = theme.layout.contentWidth - 2;

/** Combat pile a card currently sits in (#56). */
type Pile = 'hand' | 'draw' | 'disc';
/** Short, ASCII-safe pile label shown in the row header. */
const PILE_LABEL: Readonly<Record<Pile, string>> = { hand: 'hand', draw: 'draw', disc: 'discard' };
/** Pile colors route through theme tokens (hand=ready, draw=accent, disc=muted). */
const PILE_COLOR: Readonly<Record<Pile, InkColor>> = {
  hand: theme.colors.success,
  draw: theme.colors.accent,
  disc: theme.colors.muted,
};
/** Listing order so same-pile cards read as a contiguous group. */
const PILE_ORDER: readonly Pile[] = ['hand', 'draw', 'disc'];

interface DeckRow {
  readonly card: {
    id: string;
    name: string;
    cost: number;
    type: CardType;
    rarity: Rarity;
    description: string;
  };
  readonly upgraded: boolean;
  /**
   * Whether this card has a reachable upgrade path. Computed with the SAME rule
   * the rest site uses to count "(N upgradeable)" (RestScreen.upgradeable):
   * `card.upgradeTo` is set AND that target id resolves in the registry. Keeping
   * the two in lockstep means the deck-view marker count matches the rest-site
   * count exactly — already-upgraded `-plus` leaves have no `upgradeTo` and so
   * are (correctly) not marked.
   */
  readonly canUpgrade: boolean;
  readonly count: number;
  /** Combat pile this grouped row belongs to (undefined in whole-deck mode). */
  readonly pile?: Pile;
}

/** Resolve a card id + grouped count (+ optional pile) into a renderable row. */
function toRow(
  id: string,
  count: number,
  content: ContentRegistry,
  pile?: Pile,
): DeckRow | null {
  const card = content.cards[id];
  if (!card) return null;
  return {
    card: {
      id: card.id,
      name: card.name,
      cost: card.cost,
      type: card.type,
      rarity: card.rarity,
      description: card.description,
    },
    // Upgraded variants are leaf nodes (no further upgradeTo) whose id ends -plus.
    upgraded: card.upgradeTo === undefined && card.id.endsWith('-plus'),
    // Mirror RestScreen.upgradeable: a valid upgrade target that resolves.
    canUpgrade: card.upgradeTo !== undefined && content.cards[card.upgradeTo] !== undefined,
    count,
    ...(pile ? { pile } : {}),
  };
}

/** Player-reasoning sort: type -> rarity -> name (within a pile, in combat). */
function sortRows(rows: DeckRow[]): void {
  rows.sort(
    (a, b) =>
      TYPE_ORDER[a.card.type] - TYPE_ORDER[b.card.type] ||
      RARITY_ORDER[a.card.rarity] - RARITY_ORDER[b.card.rarity] ||
      a.card.name.localeCompare(b.card.name),
  );
}

/** Group one pile's ids (collapse identical ids) into sorted rows. */
function pileRows(ids: readonly string[], content: ContentRegistry, pile: Pile): DeckRow[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows: DeckRow[] = [];
  for (const [id, count] of counts) {
    const row = toRow(id, count, content, pile);
    if (row) rows.push(row);
  }
  sortRows(rows);
  return rows;
}

/** Group identical ids, resolve to defs, and sort by type -> rarity -> name. */
function buildRows(state: RunState, content: ContentRegistry): DeckRow[] {
  const counts = new Map<string, number>();
  for (const id of state.deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows: DeckRow[] = [];
  for (const [id, count] of counts) {
    const row = toRow(id, count, content);
    if (row) rows.push(row);
  }
  sortRows(rows);
  return rows;
}

/**
 * Combat listing (#56): rows grouped by pile in hand -> draw -> disc order, each
 * group sorted internally. Same id can appear in multiple piles, so rows are
 * keyed by pile+id (see the render).
 */
function buildCombatRows(
  combat: NonNullable<RunState['combat']>,
  content: ContentRegistry,
): DeckRow[] {
  const byPile: Readonly<Record<Pile, readonly string[]>> = {
    hand: combat.hand,
    draw: combat.drawPile,
    disc: combat.discardPile,
  };
  return PILE_ORDER.flatMap((pile) => pileRows(byPile[pile], content, pile));
}

/**
 * Two-line entry: the compact `(cost) Name [+]  type  xN` header plus a dim,
 * single-line effect description so the player can see what the card DOES. The
 * description is wrap="truncate" so a long effect never spills to a second row
 * and breaks the page row budget.
 */
function DeckRowLine({ row }: { readonly row: DeckRow }) {
  return (
    <Box flexDirection="column">
      <Box width={DESC_WIDTH} justifyContent="space-between">
        <Text>
          {'('}
          <Text color={theme.colors.cardCost}>{row.card.cost}</Text>
          {') '}
          <Text color={theme.colors.rarity[row.card.rarity]}>{row.card.name}</Text>
          {row.upgraded && <Text color={theme.colors.success}>{' [+]'}</Text>}
          {/* Upgrade-path marker (#44): same rule as the rest site, so a player
              scanning the deck sees WHICH cards the rest "(N upgradeable)" means. */}
          {row.canUpgrade && <Text color={theme.colors.accent}>{' ^'}</Text>}
        </Text>
        <Text>
          {/* Combat pile tag (#56): WHERE this card currently sits. */}
          {row.pile && (
            <Text color={PILE_COLOR[row.pile]}>{`${PILE_LABEL[row.pile]} `}</Text>
          )}
          <Text color={theme.colors.cardType[row.card.type]}>{row.card.type}</Text>
          {row.count > 1 && <Text dimColor>{` x${row.count}`}</Text>}
        </Text>
      </Box>
      <Box width={DESC_WIDTH}>
        <Text color={theme.colors.muted} dimColor wrap="truncate">
          {row.card.description}
        </Text>
      </Box>
    </Box>
  );
}

export function DeckView({
  state,
  content,
  onClose,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly onClose: () => void;
}) {
  // #56: in combat we read the live piles (and label/group by them); on the map
  // we group the whole deck as before. The overlay never mutates either.
  const combat = state.phase === 'combat' ? state.combat : null;
  const rows = combat ? buildCombatRows(combat, content) : buildRows(state, content);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const [page, setPage] = useState(0);
  const safePage = Math.min(page, pageCount - 1);

  useInput((input, key) => {
    if (key.escape || input === 'v') {
      onClose();
      return;
    }
    if (input === 'n') setPage((p) => Math.min(p + 1, pageCount - 1));
    else if (input === 'p') setPage((p) => Math.max(p - 1, 0));
  });

  const start = safePage * PER_PAGE;
  const pageRows = rows.slice(start, start + PER_PAGE);

  // Combat title carries an ASCII pile summary so the player sees the split at a
  // glance even when a pile's cards fall on another page.
  const title = combat
    ? `Your deck: draw ${combat.drawPile.length} | hand ${combat.hand.length} | discard ${combat.discardPile.length}`
    : `Your deck (${state.deck.length} cards)`;

  return (
    <Screen
      title={title}
      footer={`${pageCount > 1 ? `page ${safePage + 1}/${pageCount}  [n]ext [p]rev  ` : ''}[esc/v] close`}
      framed={false}
    >
      <Box flexDirection="column">
        {pageRows.map((row) => (
          <DeckRowLine key={`${row.pile ?? 'deck'}-${row.card.id}`} row={row} />
        ))}
      </Box>
    </Screen>
  );
}
