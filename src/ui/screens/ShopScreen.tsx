import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ContentRegistry, GameAction, RunState } from '../../engine/types.js';
import { theme, POTION_KEYS } from '../theme.js';
import { CardTile } from '../components/CardTile.js';
import { Screen } from '../components/Screen.js';
import { MIN_DECK_SIZE, SHOP_REMOVAL_COST } from '../../engine/run.js';

/**
 * Whether a stock item is BUYABLE given the player's gold (and, for potions, a
 * free satchel slot). Pure + exported so the dimming decision (#44) — an
 * unaffordable item, `price > gold`, renders dimmed — is unit-testable without
 * depending on ANSI styling in the rendered frame (ink-testing-library strips
 * color). The screen passes `dim={!buyable}` so this is the single source of
 * truth for "is this row actionable". Display only: it gates no engine action.
 */
export function isBuyable(
  item: { readonly sold: boolean; readonly price: number },
  gold: number,
  slotFree = true,
): boolean {
  return !item.sold && slotFree && gold >= item.price;
}

/**
 * Whether the card-removal service is available right now (#49): not yet used
 * this shop visit, the player can afford it, AND the deck is above the floor.
 * Pure + exported so the affordance's dim/disabled state is unit-testable
 * without ANSI. Mirrors the `removeCard` guards in run.ts exactly so the UI and
 * engine agree on when the service is actionable. Display only: it gates the UI
 * affordance, but the engine re-validates on dispatch.
 */
export function canRemove(state: RunState): boolean {
  if (!state.shop || state.shop.removeUsed) return false;
  return state.gold >= SHOP_REMOVAL_COST && state.deck.length > MIN_DECK_SIZE;
}

/**
 * Removable deck cards per page in the chooser. Each entry is 2 rows (header +
 * dim description, mirroring the rest-site / deck-view pattern), and a full page
 * plus chrome (title/divider/intro/footer) must stay under the ~30-row snapshot
 * budget. Ten gives 20 body rows + chrome, comfortably under 30, while single
 * digits 1-9 plus paging keep every card reachable for decks of any size.
 */
const PER_PAGE = 9;

/** Inner text width of the unframed Screen (contentWidth - paddingX*2). */
const DESC_WIDTH = theme.layout.contentWidth - 2;

/** One removable card: a compact `[N] (cost) Name` header + dim description. */
function RemoveOption({
  marker,
  card,
}: {
  readonly marker: string;
  readonly card: { readonly name: string; readonly cost: number; readonly description: string };
}) {
  return (
    <Box flexDirection="column" width={DESC_WIDTH}>
      <Text>
        <Text bold>{marker}</Text>
        {' ('}
        <Text color={theme.colors.cardCost}>{card.cost}</Text>
        {') '}
        <Text bold>{card.name}</Text>
      </Text>
      <Box paddingLeft={2}>
        <Text color={theme.colors.muted} dimColor wrap="truncate">
          {card.description}
        </Text>
      </Box>
    </Box>
  );
}

export function ShopScreen({
  state,
  content,
  dispatch,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
}) {
  const stock = state.shop?.stock ?? [];
  const potionStock = state.shop?.potionStock ?? [];
  const potionKeys = POTION_KEYS.slice(0, potionStock.length);
  const slotFree = state.potions.length < state.maxPotions;
  const removable = canRemove(state);
  const removeUsed = state.shop?.removeUsed ?? false;

  // The removal chooser is a screen-local sub-view (the engine has no shop
  // sub-phase, mirroring how the rest site hosts its upgrade chooser locally).
  const [view, setView] = useState<'shop' | 'remove'>('shop');
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(state.deck.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PER_PAGE;
  const pageCards = state.deck.slice(start, start + PER_PAGE);

  useInput((input, key) => {
    if (view === 'remove') {
      if (key.escape) {
        setView('shop');
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
      const sel = Number(input);
      if (Number.isInteger(sel) && sel >= 1 && sel <= pageCards.length) {
        dispatch({ type: 'removeCard', deckIndex: start + sel - 1 });
        setView('shop');
      }
      return;
    }
    // shop view
    if (input === 'l') {
      dispatch({ type: 'leaveShop' });
      return;
    }
    if (input === 'r' && removable) {
      setPage(0);
      setView('remove');
      return;
    }
    const potionIndex = potionKeys.indexOf(input);
    if (potionIndex >= 0) {
      const item = potionStock[potionIndex];
      if (item && !item.sold && slotFree && state.gold >= item.price) {
        dispatch({ type: 'buyPotion', index: potionIndex });
      }
      return;
    }
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > stock.length) return;
    const item = stock[n - 1];
    if (item && !item.sold && state.gold >= item.price) {
      dispatch({ type: 'buyCard', index: n - 1 });
    }
  });

  if (view === 'remove') {
    return (
      <Screen
        title="Remove a card:"
        footer={`${pageCount > 1 ? `page ${safePage + 1}/${pageCount}  [n]ext [p]rev  ` : ''}[esc] Back`}
        framed={false}
      >
        <Text bold>
          The merchant produces a small, sharp knife. {'"'}Some baggage is best left behind.{'"'}
        </Text>
        <Text dimColor>
          Cost: <Text color={theme.colors.gold} dimColor={false}>{SHOP_REMOVAL_COST}g</Text>
        </Text>
        <Box flexDirection="column" marginTop={1} width={theme.layout.contentWidth}>
          {pageCards.map((cardId, i) => {
            const card = content.cards[cardId];
            if (!card) return null;
            return (
              <RemoveOption key={`${cardId}-${start + i}`} marker={`[${i + 1}]`} card={card} />
            );
          })}
        </Box>
      </Screen>
    );
  }

  return (
    <Screen
      title="The Shop"
      footer="number: buy card  letter: buy potion  r: remove card  l: leave"
      framed={false}
    >
      <Text bold>
        A cloaked merchant grins. {'"'}Adventurer prices,{'"'} it says, of the markup.
      </Text>
      <Box marginTop={1} flexDirection="row" flexWrap="wrap" width={theme.layout.contentWidth}>
        {stock.map((item, i) => {
          const card = content.cards[item.cardId];
          if (!card) return null;
          const buyable = isBuyable(item, state.gold);
          return (
            <CardTile
              key={`${item.cardId}-${i}`}
              marker={`[${i + 1}]`}
              card={card}
              dim={!buyable}
              trailing={
                <Text dimColor={!buyable}>
                  {item.sold ? (
                    '(sold)'
                  ) : (
                    <Text color={theme.colors.gold} dimColor={false}>
                      {item.price}g
                    </Text>
                  )}
                </Text>
              }
            />
          );
        })}
      </Box>
      {potionStock.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.colors.accent}>Potions:</Text>
          {potionStock.map((item, i) => {
            const potion = content.potions[item.potionId];
            if (!potion) return null;
            const buyable = isBuyable(item, state.gold, slotFree);
            return (
              <Text key={`${item.potionId}-${i}`} dimColor={!buyable}>
                ({potionKeys[i] ?? '?'}) {potion.name} - {potion.description}{' '}
                {item.sold ? (
                  '(sold)'
                ) : (
                  // Keep the price readable even when the row is dimmed for
                  // unaffordability (mirrors the card tile's price) — the dim
                  // signals "can't buy", but the player still needs the number.
                  <Text color={theme.colors.gold} dimColor={false}>
                    {item.price}g
                  </Text>
                )}
              </Text>
            );
          })}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold color={theme.colors.accent}>Services:</Text>
        {/* Deck-thinning (#49): dimmed when unavailable — already used this
            visit, can't afford it, or the deck is at the floor — with the
            reason inline so the player knows why it's not actionable. */}
        <Text dimColor={!removable}>
          [r] Remove a card{' '}
          <Text color={theme.colors.gold} dimColor={false}>{SHOP_REMOVAL_COST}g</Text>
          {removeUsed
            ? ' (already used)'
            : state.deck.length <= MIN_DECK_SIZE
              ? ' (deck too small)'
              : state.gold < SHOP_REMOVAL_COST
                ? ' (need more gold)'
                : ''}
        </Text>
      </Box>
    </Screen>
  );
}
