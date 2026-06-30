import { Text, useInput } from 'ink';
import type {
  ContentRegistry,
  GameAction,
  MapNode,
  NodeKind,
  RunState,
} from '../../engine/types.js';
import { ACT_TRANSITION_EXHAUSTION_HP } from '../../engine/run.js';
import { theme } from '../theme.js';
import { Screen } from '../components/Screen.js';

const KIND_LABEL: Readonly<Record<NodeKind, string>> = {
  start: 'Start',
  combat: 'Combat',
  elite: 'ELITE combat (harder, better loot)',
  event: 'Unknown event (risk/reward)',
  shop: 'Shop (spend gold)',
  rest: 'Rest site (heal or upgrade)',
  boss: 'THE BOSS',
};

// The #60 category hint kept on every event node so stakes always read at a
// glance — on revealed nodes it tags the named event, on hidden nodes it keeps
// the mystery flavor.
const EVENT_TAG = ' (risk/reward)';
// Column budget: "[n] " prefix (4) eats into the Screen's ~76-col line budget.
// Truncate long event names gracefully so labels never blow the budget.
const MAX_EVENT_NAME = 76 - 4 - EVENT_TAG.length;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * #69 Tiered reveal: event nodes are labeled PER-NODE. Look up the stored
 * eventId; if the event is `hiddenOnMap` (the curated spicy gambles) keep it a
 * "??? Unknown" mystery, otherwise show its NAME. Non-event nodes use the
 * shared KIND_LABEL. Falls back to the generic event label if the id is missing.
 */
function nodeLabel(node: MapNode, content: ContentRegistry): string {
  if (node.kind !== 'event') return KIND_LABEL[node.kind];
  const def = node.eventId ? content.events[node.eventId] : undefined;
  if (!def) return KIND_LABEL.event;
  const name = def.hiddenOnMap ? '??? Unknown event' : def.name;
  return `${truncate(name, MAX_EVENT_NAME)}${EVENT_TAG}`;
}

export function MapScreen({
  state,
  content,
  dispatch,
  onViewDeck,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
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
            {nodeLabel(option, content)}
          </Text>
        </Text>
      ))}
    </Screen>
  );
}
