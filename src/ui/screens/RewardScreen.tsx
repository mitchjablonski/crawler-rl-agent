import { Box, Text, useInput } from 'ink';
import type { ContentRegistry, GameAction, RunState } from '../../engine/types.js';

export function RewardScreen({
  state,
  content,
  dispatch,
  relicDisplayName,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
  readonly relicDisplayName?: string;
}) {
  const reward = state.reward;
  const cards = reward?.cards ?? [];

  useInput((input) => {
    if (input === 's') {
      dispatch({ type: 'skipReward' });
      return;
    }
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= cards.length) {
      dispatch({ type: 'pickRewardCard', index: n - 1 });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="yellow">
        Victory! +{reward?.gold ?? 0}g
      </Text>
      {reward?.relicId !== undefined && (
        <Text color="cyan">
          Relic claimed:{' '}
          {relicDisplayName ?? content.relics[reward.relicId]?.name ?? reward.relicId}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Take a card for your deck:</Text>
        {cards.map((cardId, i) => {
          const card = content.cards[cardId];
          if (!card) return null;
          return (
            <Text key={cardId}>
              [{i + 1}] ({card.cost}) {card.name} - {card.description}
            </Text>
          );
        })}
        <Text dimColor>[s] Skip</Text>
      </Box>
    </Box>
  );
}
