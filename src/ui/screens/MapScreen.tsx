import { Box, Text, useInput } from 'ink';
import type { GameAction, MapNode, NodeKind, RunState } from '../../engine/types.js';

const KIND_LABEL: Readonly<Record<NodeKind, string>> = {
  start: 'Start',
  combat: 'Combat',
  elite: 'ELITE combat',
  event: 'Unknown event',
  shop: 'Shop',
  rest: 'Rest site',
  boss: 'THE BOSS',
};

export function MapScreen({
  state,
  dispatch,
}: {
  readonly state: RunState;
  readonly dispatch: (action: GameAction) => void;
}) {
  const node = state.map.nodes[state.currentNodeId];
  const options = (node?.next ?? [])
    .map((id) => state.map.nodes[id])
    .filter((n): n is MapNode => n !== undefined);
  const bossRow = state.map.nodes[state.map.bossId]?.row ?? 0;

  useInput((input) => {
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      dispatch({ type: 'chooseNode', nodeId: (options[n - 1] as MapNode).id });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>
        Depth {node?.row ?? 0}/{bossRow}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>The passage forks. Choose your path:</Text>
        {options.map((option, i) => (
          <Text key={option.id}>
            [{i + 1}] {KIND_LABEL[option.kind]}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>press a number to descend</Text>
      </Box>
    </Box>
  );
}
