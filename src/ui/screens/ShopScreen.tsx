import { Box, Text, useInput } from 'ink';
import type { ContentRegistry, GameAction, RunState } from '../../engine/types.js';

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

  useInput((input) => {
    if (input === 'l') {
      dispatch({ type: 'leaveShop' });
      return;
    }
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > stock.length) return;
    const item = stock[n - 1];
    if (item && !item.sold && state.gold >= item.price) {
      dispatch({ type: 'buyCard', index: n - 1 });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        A cloaked merchant grins. {'"'}Adventurer prices,{'"'} it says, of the markup.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {stock.map((item, i) => {
          const card = content.cards[item.cardId];
          if (!card) return null;
          const buyable = !item.sold && state.gold >= item.price;
          return (
            <Text key={`${item.cardId}-${i}`} dimColor={!buyable}>
              [{i + 1}] {card.name} - {card.description}{' '}
              {item.sold ? '(sold)' : `${item.price}g`}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>number: buy  l: leave</Text>
      </Box>
    </Box>
  );
}
