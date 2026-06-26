import { Box, Text, useApp, useInput } from 'ink';
import type { RunState } from '../../engine/types.js';
import { theme } from '../theme.js';
import { Screen } from '../components/Screen.js';

export function GameOverScreen({
  state,
  relicNames,
  onNew,
  onTitle,
  dailyDate,
  score,
  priorBest,
}: {
  readonly state: RunState;
  /**
   * Held relics by display name (christened epithet preferred over base name),
   * computed in App to mirror the StatusBar relic pattern (#21). Empty => "none".
   */
  readonly relicNames: readonly string[];
  readonly onNew: () => void;
  readonly onTitle: () => void;
  /** E3: set when the finished run was the daily challenge. */
  readonly dailyDate?: string;
  /** #28: this run's pure score (also the daily score for a daily run). */
  readonly score: number;
  /**
   * #28: personal best for this run's (character, mode) among PRIOR runs, or
   * null when this is the first such run (which therefore reads as a NEW BEST).
   */
  readonly priorBest: number | null;
}) {
  const { exit } = useApp();
  const won = state.phase === 'victory';

  useInput((input) => {
    if (input === 'n') onNew();
    else if (input === 't') onTitle();
    else if (input === 'q') exit();
  });

  // Depth reached: how far into the map this run got. The boss sits on the
  // deepest row, so its row is the run's full length.
  const depth = state.map.nodes[state.currentNodeId]?.row ?? 0;
  const bossRow = state.map.nodes[state.map.bossId]?.row ?? depth;
  const relics = relicNames.length > 0 ? relicNames.join(', ') : 'none';

  // #28: a run beats its personal best when there is no prior best (first such
  // run) or it strictly exceeds it. NEW BEST celebrates; otherwise show the
  // run's score next to the standing best.
  const newBest = priorBest === null || score > priorBest;

  return (
    <Screen title={won ? 'Run Complete' : 'Run Ended'} footer="[n] new delve  [t] title  [q] quit">
      <Text bold color={won ? theme.colors.success : theme.colors.danger}>
        {won ? 'THE SCOPE CREEP IS SLAIN' : 'YOU DIED'}
      </Text>
      <Text dimColor>
        {won
          ? 'The dungeon grumbles and starts drafting new requirements.'
          : 'The dungeon thanks you for your engagement.'}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {newBest ? (
          <Text bold color={theme.colors.success}>
            NEW BEST!  {score}
            {priorBest !== null && (
              <Text color={theme.colors.muted}>  (prev {priorBest})</Text>
            )}
          </Text>
        ) : (
          <Text>
            <Text bold color={theme.colors.accent}>
              Score {score}
            </Text>
            <Text color={theme.colors.muted}>   ·   Best {priorBest}</Text>
          </Text>
        )}
        {dailyDate !== undefined && (
          <Text color={theme.colors.muted}>Daily {dailyDate}</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={theme.colors.muted}>Depth reached </Text>
          <Text color={theme.colors.accent}>
            {depth}/{bossRow}
          </Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>Final HP </Text>
          <Text color={theme.colors.hp}>
            {state.hp}/{state.maxHp}
          </Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>Deck </Text>
          <Text>{state.deck.length} cards</Text>
          <Text color={theme.colors.muted}>   Gold </Text>
          <Text color={theme.colors.gold}>{state.gold}g</Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>Turns </Text>
          <Text color={theme.colors.accent}>{state.stats.turns}</Text>
          <Text color={theme.colors.muted}>   Dealt </Text>
          <Text color={theme.colors.accent}>{state.stats.damageDealt}</Text>
          <Text color={theme.colors.muted}>   Taken </Text>
          <Text color={theme.colors.hp}>{state.stats.damageTaken}</Text>
          <Text color={theme.colors.muted}>   Slain </Text>
          <Text color={theme.colors.accent}>{state.stats.enemiesSlain}</Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>Relics </Text>
          <Text color={theme.colors.accent}>{relics}</Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>Seed </Text>
          <Text>{state.seed}</Text>
        </Text>
      </Box>
    </Screen>
  );
}
