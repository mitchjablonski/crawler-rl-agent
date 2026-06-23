import { Box, Text, useInput } from 'ink';
import type { GameAction } from '../../engine/types.js';

export function RestScreen({
  dispatch,
}: {
  readonly dispatch: (action: GameAction) => void;
}) {
  useInput((input) => {
    if (input === 'r') dispatch({ type: 'rest' });
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>A defensible alcove, warm and quiet.</Text>
      <Text dimColor>Someone has carved {'"'}5 stars, would die here again{'"'} into the wall.</Text>
      <Box marginTop={1}>
        <Text>[r] Rest (heal 30% of max HP)</Text>
      </Box>
    </Box>
  );
}
