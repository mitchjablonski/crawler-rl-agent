import { Box, Text, useInput } from 'ink';
import type { ContentRegistry, GameAction, RunState } from '../../engine/types.js';

export function EventScreen({
  state,
  content,
  dispatch,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
}) {
  const def = state.event ? content.events[state.event.eventId] : undefined;
  const options = def?.options ?? [];

  useInput((input) => {
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      dispatch({ type: 'chooseEventOption', index: n - 1 });
    }
  });

  if (!def) return null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="yellow">
        {def.name}
      </Text>
      <Box marginTop={1} width={76}>
        <Text wrap="wrap">{def.prompt}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, i) => (
          <Text key={option.label}>
            [{i + 1}] {option.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
