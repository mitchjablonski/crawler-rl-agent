import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  CombatState,
  ContentRegistry,
  EnemyInstance,
  GameAction,
  RunState,
} from '../../engine/types.js';

function intentFor(content: ContentRegistry, enemy: EnemyInstance): string {
  const def = content.enemies[enemy.defId];
  const move = def?.moves[enemy.nextMoveIndex % (def?.moves.length ?? 1)];
  if (!move) return '?';
  const damage = move.effects
    .flatMap((fx) =>
      fx.kind === 'damage'
        ? [`${fx.amount}${(fx.times ?? 1) > 1 ? `x${fx.times}` : ''}`]
        : [],
    )
    .join('+');
  return damage ? `${move.name} (${damage})` : move.name;
}

function statusLine(enemy: EnemyInstance): string {
  const parts = Object.entries(enemy.statuses).map(([k, v]) => `${k} ${v}`);
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

export function CombatScreen({
  state,
  content,
  dispatch,
  nameFor,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
  readonly nameFor?: (defId: string) => string | undefined;
}) {
  const combat = state.combat as CombatState;
  const [pendingCard, setPendingCard] = useState<number | null>(null);
  const living = combat.enemies
    .map((enemy, index) => ({ enemy, index }))
    .filter(({ enemy }) => enemy.hp > 0);

  useInput((input, key) => {
    if (key.escape) {
      setPendingCard(null);
      return;
    }
    if (input === 'e') {
      setPendingCard(null);
      dispatch({ type: 'endTurn' });
      return;
    }
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1) return;

    if (pendingCard !== null) {
      const target = combat.enemies[n - 1];
      if (target && target.hp > 0) {
        dispatch({ type: 'playCard', handIndex: pendingCard, targetIndex: n - 1 });
        setPendingCard(null);
      }
      return;
    }

    const handIndex = n - 1;
    const cardId = combat.hand[handIndex];
    if (cardId === undefined) return;
    const card = content.cards[cardId];
    if (!card || card.cost > combat.energy) return;
    if (card.target === 'enemy') {
      if (living.length === 1) {
        dispatch({ type: 'playCard', handIndex, targetIndex: living[0]?.index });
      } else {
        setPendingCard(handIndex);
      }
    } else {
      dispatch({ type: 'playCard', handIndex });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        {combat.enemies.map((enemy, i) => (
          <Text key={`${enemy.defId}-${i}`} dimColor={enemy.hp <= 0}>
            {pendingCard !== null && enemy.hp > 0 ? `[${i + 1}] ` : '    '}
            <Text bold>{nameFor?.(enemy.defId) ?? enemy.name}</Text>{' '}
            {enemy.hp <= 0
              ? 'slain'
              : `${enemy.hp}/${enemy.maxHp}${enemy.block > 0 ? ` +${enemy.block}blk` : ''}`}
            {enemy.hp > 0 && (
              <Text color="red">
                {'  '}next: {intentFor(content, enemy)}
              </Text>
            )}
            <Text color="cyan">{statusLine(enemy)}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{pendingCard !== null ? 'Choose a target:' : 'Your hand:'}</Text>
        {combat.hand.map((cardId, i) => {
          const card = content.cards[cardId];
          if (!card) return null;
          const affordable = card.cost <= combat.energy;
          return (
            <Text key={`${cardId}-${i}`} dimColor={!affordable}>
              [{i + 1}] ({card.cost}) {card.name} - {card.description}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {pendingCard !== null
            ? 'number: target  esc: cancel'
            : 'number: play card  e: end turn'}
        </Text>
      </Box>
    </Box>
  );
}
