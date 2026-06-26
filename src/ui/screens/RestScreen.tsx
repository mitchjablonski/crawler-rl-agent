import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ContentRegistry, GameAction, RunState } from '../../engine/types.js';
import { theme } from '../theme.js';
import { Screen } from '../components/Screen.js';

/** Heal fraction must match the `rest` reducer in run.ts (state.maxHp * 0.2). */
const HEAL_PCT = 20;

/**
 * Upgradeable cards per page. Single-digit hotkeys could cap a page at 9, but
 * each option spends 2 rows (header + base->upgraded delta, the delta wrapping
 * to a 3rd row for long cards), and a full page must fit the ~30-row snapshot
 * budget with the header and `[esc]` footer still on-screen. The starter deck
 * is 9 cards, ALL upgradeable, so the very first rest hits a full page — six
 * keeps even an all-wrapping page (6*3=18 body rows + chrome) under 30.
 */
const PER_PAGE = 6;

/** Deck cards (with their deck index) that have a valid upgrade target. */
function upgradeable(
  state: RunState,
  content: ContentRegistry,
): { deckIndex: number; cardId: string; upgradeId: string }[] {
  const out: { deckIndex: number; cardId: string; upgradeId: string }[] = [];
  state.deck.forEach((cardId, deckIndex) => {
    const card = content.cards[cardId];
    if (card?.upgradeTo && content.cards[card.upgradeTo]) {
      out.push({ deckIndex, cardId, upgradeId: card.upgradeTo });
    }
  });
  return out;
}

/**
 * One upgradeable card rendered as a base->upgraded COMPARISON so the upgrade is
 * an informed choice (the chooser used to show only the upgraded card, leaving
 * the player to recall base stats from memory). Kept to TWO compact rows so a
 * full PER_PAGE page fits the ~30-row snapshot budget with chrome (see PER_PAGE):
 *   - header:  [N] (cost) Name
 *   - delta:     was <base effect>  ->  now <upgraded effect>   (may wrap once)
 * No blank-line gap between options — the header line gives enough separation,
 * and a trailing margin per option blew the row budget at a full page. `was`
 * reads muted (current) and `now` reads success (the improvement) so the delta
 * is scannable at a glance. Colors route through theme tokens only.
 */
function UpgradeOption({
  marker,
  base,
  upgraded,
}: {
  readonly marker: string;
  readonly base: { readonly name: string; readonly cost: number; readonly description: string };
  readonly upgraded: { readonly description: string };
}) {
  return (
    <Box flexDirection="column" width={theme.layout.contentWidth - 2}>
      <Text>
        <Text bold>{marker}</Text>
        {' ('}
        <Text color={theme.colors.cardCost}>{base.cost}</Text>
        {') '}
        <Text bold>{base.name}</Text>
      </Text>
      <Box paddingLeft={2}>
        <Text wrap="wrap">
          <Text color={theme.colors.muted}>was </Text>
          <Text color={theme.colors.muted}>{base.description}</Text>
          <Text color={theme.colors.accent}>{'  ->  '}</Text>
          <Text color={theme.colors.success}>now </Text>
          <Text color={theme.colors.success}>{upgraded.description}</Text>
        </Text>
      </Box>
    </Box>
  );
}

export function RestScreen({
  state,
  content,
  dispatch,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
}) {
  // The engine has no rest sub-phase; the rest/upgrade choice lives here only.
  const [view, setView] = useState<'menu' | 'upgrade'>('menu');
  // Paging keeps every upgradeable card reachable via single-digit hotkeys
  // while a full page still fits the row budget (see PER_PAGE).
  const [page, setPage] = useState(0);
  const options = upgradeable(state, content);
  const pageCount = Math.max(1, Math.ceil(options.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PER_PAGE;
  const pageOptions = options.slice(start, start + PER_PAGE);

  useInput((input, key) => {
    if (view === 'menu') {
      if (input === 'r') dispatch({ type: 'rest' });
      else if (input === 'u' && options.length > 0) {
        setPage(0);
        setView('upgrade');
      }
      return;
    }
    // upgrade view
    if (key.escape) {
      setView('menu');
      return;
    }
    if (input === 'n') {
      setPage((p) => Math.min(p + 1, pageCount - 1));
      return;
    }
    if (input === 'p') {
      setPage((p) => Math.max(p - 1, 0));
      return;
    }
    const n = Number(input);
    // Single-digit keys select within the current page (page-relative index).
    if (Number.isInteger(n) && n >= 1 && n <= pageOptions.length) {
      dispatch({ type: 'upgradeCard', deckIndex: pageOptions[n - 1]!.deckIndex });
    }
  });

  if (view === 'upgrade') {
    return (
      <Screen
        title="Upgrade a card:"
        footer={`${pageCount > 1 ? `page ${safePage + 1}/${pageCount}  [n]ext [p]rev  ` : ''}[esc] Back`}
        framed={false}
      >
        <Text bold>A defensible alcove, warm and quiet.</Text>
        <Box flexDirection="column" marginTop={1} width={theme.layout.contentWidth}>
          {pageOptions.map(({ cardId, upgradeId, deckIndex }, i) => {
            const base = content.cards[cardId];
            const upgraded = content.cards[upgradeId];
            if (!base || !upgraded) return null;
            return (
              <UpgradeOption
                key={`${upgradeId}-${deckIndex}`}
                marker={`[${i + 1}]`}
                base={base}
                upgraded={upgraded}
              />
            );
          })}
        </Box>
      </Screen>
    );
  }

  return (
    <Screen title="The Rest Site" footer="[r] rest  [u] upgrade">
      <Text bold>A defensible alcove, warm and quiet.</Text>
      <Text dimColor>Someone has carved {'"'}5 stars, would die here again{'"'} into the wall.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>[r] Rest (heal {HEAL_PCT}% of max HP)</Text>
        <Text dimColor={options.length === 0}>
          [u] Upgrade a card{options.length === 0 ? ' (none upgradeable)' : ` (${options.length} upgradeable)`}
        </Text>
      </Box>
    </Screen>
  );
}
