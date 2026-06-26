import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { CardDef } from '../../engine/types.js';
import { theme } from '../theme.js';

/**
 * Dumb presentational card frame: ONE card rendered as a bordered tile.
 *
 * Used identically by the combat hand, reward choices and shop stock so a card
 * looks the same everywhere (consistency is the whole point of the frame). It
 * holds no game logic — the caller decides the selection marker, affordability
 * and any trailing annotation (e.g. a shop price), and owns all keypress
 * handling. Colors route exclusively through `theme` tokens.
 *
 * Layout: a fixed-width round-bordered box. The header row is
 * `MARKER (COST) NAME            TYPE`, the body is the wrapped description.
 * Fixed width means a row of tiles wraps predictably and never overruns
 * `theme.layout.contentWidth`.
 */
export const CARD_TILE_WIDTH = 36;

export function CardTile({
  marker,
  card,
  dim = false,
  trailing,
}: {
  /** Selection marker the caller presses, e.g. `[1]` for cards. */
  readonly marker: string;
  readonly card: CardDef;
  /** Dim the whole tile (unaffordable) while keeping the cost pip readable. */
  readonly dim?: boolean;
  /** Optional trailing annotation rendered under the description (e.g. price). */
  readonly trailing?: ReactNode;
}) {
  return (
    <Box
      borderStyle={theme.box.panel}
      borderColor={theme.colors[theme.box.borderColor]}
      borderDimColor={dim}
      flexDirection="column"
      width={CARD_TILE_WIDTH}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text dimColor={dim}>
          <Text bold>{marker}</Text>
          {' ('}
          <Text color={theme.colors.cardCost} dimColor={false}>
            {card.cost}
          </Text>
          {') '}
          <Text color={theme.colors.rarity[card.rarity]}>{card.name}</Text>
          {card.upgradeTo === undefined && card.id.endsWith('-plus') && (
            <Text color={theme.colors.success} dimColor={dim}>
              {' [+]'}
            </Text>
          )}
        </Text>
        <Text color={theme.colors.cardType[card.type]} dimColor={dim}>
          {card.type}
        </Text>
      </Box>
      <Text dimColor={dim} wrap="wrap">
        {card.description}
      </Text>
      {trailing !== undefined && <Box>{trailing}</Box>}
    </Box>
  );
}
