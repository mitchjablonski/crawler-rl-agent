import { Text, useInput } from 'ink';
import type { GameAction, MapNode, NodeKind, RunState } from '../../engine/types.js';
import { ACT_TRANSITION_EXHAUSTION_HP } from '../../engine/run.js';
import { theme } from '../theme.js';
import { Screen } from '../components/Screen.js';

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
  onViewDeck,
}: {
  readonly state: RunState;
  readonly dispatch: (action: GameAction) => void;
  /** Opens the read-only deck overlay (App-local UI state; no engine change). */
  readonly onViewDeck: () => void;
}) {
  const node = state.map.nodes[state.currentNodeId];
  const options = (node?.next ?? [])
    .map((id) => state.map.nodes[id])
    .filter((n): n is MapNode => n !== undefined);
  const bossRow = state.map.nodes[state.map.bossId]?.row ?? 0;
  // #32: warn before an act transition. Every option from an act-cap node leads
  // into the next act (the act boss links into act N+1's first row), so crossing
  // here triggers the deterministic exhaustion toll (-N max HP). Pure UI: read
  // act numbers off the map; the engine applies the cost on chooseNode.
  const crossesIntoNextAct =
    node !== undefined && options.some((o) => o.act > node.act);

  useInput((input) => {
    if (input === 'v') {
      onViewDeck();
      return;
    }
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      dispatch({ type: 'chooseNode', nodeId: (options[n - 1] as MapNode).id });
    }
  });

  return (
    <Screen
      title="The Map"
      meta={`Depth ${node?.row ?? 0}/${bossRow}`}
      footer="press a number to descend  [v] view deck"
    >
      <Text bold>The passage forks. Choose your path:</Text>
      {crossesIntoNextAct && (
        <Text color={theme.colors.danger}>
          The descent into the next act will take its toll: -
          {ACT_TRANSITION_EXHAUSTION_HP} max HP.
        </Text>
      )}
      {options.map((option, i) => (
        <Text key={option.id}>
          [{i + 1}]{' '}
          <Text color={theme.colors.nodeKind[option.kind]}>
            {KIND_LABEL[option.kind]}
          </Text>
        </Text>
      ))}
    </Screen>
  );
}
