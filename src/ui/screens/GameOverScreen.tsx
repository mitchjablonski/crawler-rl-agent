import { Box, Text, useApp, useInput } from 'ink';
import type { RunState } from '../../engine/types.js';

export function GameOverScreen({
  state,
  onNew,
  onTitle,
}: {
  readonly state: RunState;
  readonly onNew: () => void;
  readonly onTitle: () => void;
}) {
  const { exit } = useApp();
  const won = state.phase === 'victory';

  useInput((input) => {
    if (input === 'n') onNew();
    else if (input === 't') onTitle();
    else if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={won ? 'green' : 'red'}>
        {won ? 'THE SCOPE CREEP IS SLAIN' : 'YOU DIED'}
      </Text>
      <Text dimColor>
        {won
          ? 'The dungeon grumbles and starts drafting new requirements.'
          : 'The dungeon thanks you for your engagement.'}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          seed {state.seed}  -  deck {state.deck.length} cards  -  {state.gold}g
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>[n] New delve</Text>
        <Text>[t] Title</Text>
        <Text>[q] Quit</Text>
      </Box>
    </Box>
  );
}
