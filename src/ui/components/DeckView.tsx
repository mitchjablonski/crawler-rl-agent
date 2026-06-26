import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CardType, ContentRegistry, Rarity, RunState } from '../../engine/types.js';
import { theme } from '../theme.js';
import { Screen } from './Screen.js';

/**
 * Read-only overlay listing the player's whole deck outside combat.
 *
 * A deckbuilder player plans upgrade/shop choices from the map phase, so the
 * deck view must show what each card DOES, not just its name. Each grouped row
 * is therefore TWO lines: the compact `(cost) Name [+]  type  xN` header and a
 * dim, single-line (truncated) effect description under it.
 *
 * Row budget (the #30 lesson): a deck can run 15-25+ cards and a two-line entry
 * DOUBLES the per-card height, so a full deck would overflow the 30-row snapshot
 * canvas. We therefore render a single column and PAGINATE: `PER_PAGE` entries
 * per page (see its note) so a FULL page + header/divider/footer stays <=30
 * rows. Descriptions are truncated to one line so a row never wraps and inflates
 * the count. Pages flip with [n]/[p]; identical ids still collapse to one `xN`
 * row, and `[esc]/[v]` close. Upgraded (`-plus`) cards keep the `[+]`.
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
  readonly count: number;
}

/** Group identical ids, resolve to defs, and sort by type -> rarity -> name. */
function buildRows(state: RunState, content: ContentRegistry): DeckRow[] {
  const counts = new Map<string, number>();
  for (const id of state.deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows: DeckRow[] = [];
  for (const [id, count] of counts) {
    const card = content.cards[id];
    if (!card) continue;
    rows.push({
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
      count,
    });
  }
  rows.sort(
    (a, b) =>
      TYPE_ORDER[a.card.type] - TYPE_ORDER[b.card.type] ||
      RARITY_ORDER[a.card.rarity] - RARITY_ORDER[b.card.rarity] ||
      a.card.name.localeCompare(b.card.name),
  );
  return rows;
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
        </Text>
        <Text>
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
  const rows = buildRows(state, content);
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

  return (
    <Screen
      title={`Your deck (${state.deck.length} cards)`}
      footer={`${pageCount > 1 ? `page ${safePage + 1}/${pageCount}  [n]ext [p]rev  ` : ''}[esc/v] close`}
      framed={false}
    >
      <Box flexDirection="column">
        {pageRows.map((row) => (
          <DeckRowLine key={row.card.id} row={row} />
        ))}
      </Box>
    </Screen>
  );
}
