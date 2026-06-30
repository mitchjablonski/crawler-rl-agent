import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  CardDef,
  CombatState,
  ContentRegistry,
  EnemyInstance,
  GameAction,
  RunState,
  Statuses,
} from '../../engine/types.js';
import type { Effect } from '../../engine/types.js';
import type { InkColor, IntentKind } from '../theme.js';
import { theme, statusSegments, statusChip, hpBarSegments, POTION_KEYS } from '../theme.js';
import { CardTile } from '../components/CardTile.js';
import { Screen } from '../components/Screen.js';
import { resolveEnemyMove } from '../../engine/enemyMoves.js';
import { usePrevOnChange, enemyBeats } from '../juice.js';

/** Render a statuses map as theme-styled segments wrapped in brackets. */
function StatusTags({ statuses }: { readonly statuses: Statuses }) {
  const segments = statusSegments(statuses);
  if (segments.length === 0) return null;
  return (
    <Text>
      {' ['}
      {segments.map((seg, i) => (
        <Text key={seg.text} color={seg.color}>
          {i > 0 ? ', ' : ''}
          {seg.text}
        </Text>
      ))}
      {']'}
    </Text>
  );
}

/** A compact, theme-tokenized telegraph token for one upcoming move effect. */
interface IntentChip {
  readonly text: string;
  readonly color: InkColor;
}

/** The move name for an enemy's CURRENT-phase next move (anchor: `next: <icon> <name>`). */
function intentNameFor(content: ContentRegistry, enemy: EnemyInstance): string {
  const def = content.enemies[enemy.defId];
  // Use the SAME resolver the combat reducer uses so the telegraph reflects the
  // enemy's CURRENT phase (it switches the instant the boss crosses a threshold).
  const move = def && resolveEnemyMove(def, enemy);
  return move ? move.name : '?';
}

/**
 * Build the FULL telegraph for an enemy's next move as compact, theme-tokenized
 * chips so the player can see every effect the single category icon hides:
 *   - damage      -> `Ndmg` (multi-hit `NxT`), danger color (the headline threat)
 *   - block       -> `+Nblk`, block/defend color
 *   - self-buff   -> `<ICON> +N` (e.g. `STR +1`) via the canonical `statusChip`
 *   - debuff      -> `<ICON> N`  (e.g. `VUL 2`) via the canonical `statusChip`
 *   - self-heal   -> `+Nhp`, success color
 * The status chips (buff/debuff) read with the status' IDENTITY color + format
 * (the canonical `statusChip`), so a status looks the SAME here as in the enemy
 * status tags and the player's status line; only the leading category icon and
 * the non-status chips (damage/block/heal) carry threat-axis kind colors.
 * gainEnergy/draw are vanishingly rare for enemies; omitted (no player-relevant
 * threat). Pure: reads already-resolved move effects + only theme tokens.
 */
function intentChips(content: ContentRegistry, enemy: EnemyInstance): readonly IntentChip[] {
  const def = content.enemies[enemy.defId];
  const move = def && resolveEnemyMove(def, enemy);
  if (!move) return [];
  const chips: IntentChip[] = [];
  for (const fx of move.effects) {
    switch (fx.kind) {
      case 'damage': {
        const times = fx.times ?? 1;
        const text = times > 1 ? `${fx.amount}x${times}dmg` : `${fx.amount}dmg`;
        chips.push({ text, color: theme.colors.danger });
        break;
      }
      case 'block':
        chips.push({ text: `+${fx.amount}blk`, color: theme.colors.block });
        break;
      case 'heal':
        chips.push({ text: `+${fx.amount}hp`, color: theme.colors.success });
        break;
      case 'applyStatus': {
        // target 'self' = enemy buffs itself (gains stacks, shown with a +);
        // otherwise the status lands ON the player. Either way the chip uses the
        // CANONICAL status glyph (identity color + format) so it reads identically
        // to the same status in the enemy tags and the player status line.
        const isSelf = fx.target === 'self';
        const chip = statusChip(fx.status, fx.stacks, { sign: isSelf });
        chips.push({ text: chip.text, color: chip.color });
        break;
      }
      // gainEnergy / draw: not a player-facing threat for enemies — omit.
      default:
        break;
    }
  }
  return chips;
}

/**
 * Categorize the enemy's NEXT move into a semantic intent purely from its
 * effects, so the UI can show a category icon + color (attack/defend/buff/
 * debuff). Read-only: dealing damage = attack; gaining block = defend;
 * buffing self (strength/dexterity) = buff; applying a negative status to the
 * player = debuff. Attack wins ties so a hybrid move still telegraphs danger.
 */
function intentKindFor(content: ContentRegistry, enemy: EnemyInstance): IntentKind {
  const def = content.enemies[enemy.defId];
  const move = def && resolveEnemyMove(def, enemy);
  if (!move) return 'unknown';
  const fx = move.effects;
  const isBuff = (e: Effect) =>
    e.kind === 'applyStatus' && e.target === 'self';
  const isDebuff = (e: Effect) =>
    e.kind === 'applyStatus' && e.target !== 'self';
  if (fx.some((e) => e.kind === 'damage')) return 'attack';
  if (fx.some((e) => e.kind === 'block')) return 'defend';
  if (fx.some(isBuff)) return 'buff';
  if (fx.some(isDebuff)) return 'debuff';
  return 'unknown';
}

/**
 * #65 Overclocker legibility: the LIVE effective value of a missing-HP gradient
 * card, computed from the CURRENT combat HP so the player SEES the payoff number
 * rise as they take damage — the static card description only carries the base
 * plus the "+1 per N missing" template and forces mental math. Returns null for
 * cards without a `scaleMissingHp` damage/block effect (so non-gradient cards are
 * untouched). Mirrors the engine's `floor((maxHp - hp) / divisor)` EXACTLY
 * (display only — no effect/amount change). Combat-only: the map/deck view has no
 * live HP context and keeps showing the static text.
 */
function liveGradient(card: CardDef, combat: CombatState): string | null {
  for (const e of card.effects) {
    if ((e.kind === 'damage' || e.kind === 'block') && e.scaleMissingHp !== undefined) {
      const bonus = Math.floor((combat.playerMaxHp - combat.playerHp) / e.scaleMissingHp);
      const effective = e.amount + bonus;
      return `now ${effective} ${e.kind === 'damage' ? 'dmg' : 'blk'}`;
    }
  }
  return null;
}

export function CombatScreen({
  state,
  content,
  dispatch,
  nameFor,
  onViewDeck,
}: {
  readonly state: RunState;
  readonly content: ContentRegistry;
  readonly dispatch: (action: GameAction) => void;
  readonly nameFor?: (defId: string) => string | undefined;
  /**
   * Opens the read-only deck overlay (#56). App-local UI state, mirroring the
   * map's `[v] view deck`; optional so direct-render tests need not wire it.
   */
  readonly onViewDeck?: () => void;
}) {
  const combat = state.combat as CombatState;
  // V6 juice: diff the combat state the player's LAST action changed to derive
  // transient beats (damage `-N`, slain `DOWN`, block `+Nblk`). The prior combat
  // is held in a ref and only advances when a new action produces a new state
  // object, so a beat PERSISTS until the next action recomputes it (and is
  // snapshot-verifiable). Empty/zero on first combat render (no prior).
  const priorCombat = usePrevOnChange(combat);
  const beats = enemyBeats(priorCombat, combat);
  const [pendingCard, setPendingCard] = useState<number | null>(null);
  const [pendingPotion, setPendingPotion] = useState<number | null>(null);
  const living = combat.enemies
    .map((enemy, index) => ({ enemy, index }))
    .filter(({ enemy }) => enemy.hp > 0);
  // Letter keys address the satchel (shared with the shop; skips 'e' = end turn).
  const potionKeys = POTION_KEYS.slice(0, state.maxPotions);
  const pending = pendingCard !== null || pendingPotion !== null;
  // Legibility (#60): pressing an unaffordable card silently no-ops below, so
  // DERIVE a live count of hand cards whose cost exceeds current energy and
  // surface it in the footer. No new state — recomputed every render from the
  // live hand/energy, so it stays correct as energy is spent or cards drawn.
  const unplayable = combat.hand.filter(
    (id) => (content.cards[id]?.cost ?? 0) > combat.energy,
  ).length;

  useInput((input, key) => {
    if (key.escape) {
      setPendingCard(null);
      setPendingPotion(null);
      return;
    }
    // #56: open the read-only deck overlay. 'v' is not a card/potion/target key,
    // so it never conflicts; opening dispatches nothing (combat state untouched).
    if (input === 'v' && onViewDeck) {
      onViewDeck();
      return;
    }
    if (input === 'e') {
      setPendingCard(null);
      setPendingPotion(null);
      dispatch({ type: 'endTurn' });
      return;
    }

    // Potion hotkeys (only when not mid-target-select).
    if (!pending) {
      const potionIndex = potionKeys.indexOf(input);
      if (potionIndex >= 0) {
        const potionId = state.potions[potionIndex];
        if (potionId === undefined) return;
        const potion = content.potions[potionId];
        if (!potion) return;
        if (potion.target === 'enemy') {
          if (living.length === 1) {
            dispatch({ type: 'usePotion', potionIndex, targetIndex: living[0]?.index });
          } else {
            setPendingPotion(potionIndex);
          }
        } else {
          dispatch({ type: 'usePotion', potionIndex });
        }
        return;
      }
    }

    const n = Number(input);
    if (!Number.isInteger(n) || n < 1) return;

    if (pendingPotion !== null) {
      const target = combat.enemies[n - 1];
      if (target && target.hp > 0) {
        dispatch({ type: 'usePotion', potionIndex: pendingPotion, targetIndex: n - 1 });
        setPendingPotion(null);
      }
      return;
    }

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

  const footer = pending
    ? 'number: target  esc: cancel'
    : `number: play card${unplayable > 0 ? `  · ${unplayable} unplayable` : ''}  ${state.potions.length > 0 ? 'letter: use potion  ' : ''}e: end turn${onViewDeck ? '  [v] view deck' : ''}`;

  return (
    <Screen title="Combat" footer={footer} framed={false}>
      <Box flexDirection="column">
        {combat.enemies.map((enemy, i) => {
          const def = content.enemies[enemy.defId];
          const sigil = def?.sigil ?? '';
          const alive = enemy.hp > 0;
          const bar = hpBarSegments(enemy.hp, enemy.maxHp);
          const kind = intentKindFor(content, enemy);
          const beat = beats[i];
          return (
            <Box key={`${enemy.defId}-${i}`} flexDirection="column">
              {/* Header: marker, sigil, name, numeric HP, block, statuses. */}
              <Text dimColor={!alive}>
                {pending && alive ? `[${i + 1}] ` : '    '}
                {sigil ? (
                  <Text color={theme.colors.accent}>{sigil} </Text>
                ) : null}
                <Text bold>{nameFor?.(enemy.defId) ?? enemy.name}</Text>{' '}
                {!alive ? (
                  // A slain enemy that died THIS action gets an emphasized DOWN
                  // beat (danger color) on top of the dimmed row; one that was
                  // already dead just reads `slain`.
                  beat?.slain ? (
                    <Text color={theme.colors.danger} bold>
                      DOWN
                    </Text>
                  ) : (
                    'slain'
                  )
                ) : (
                  <>
                    <Text color={theme.colors.hp}>{enemy.hp}</Text>/{enemy.maxHp}
                    {enemy.block > 0 && (
                      <Text color={theme.colors.block}> +{enemy.block}blk</Text>
                    )}
                    {/* Damage DELTA from the last action (persists until next). */}
                    {beat && beat.damage > 0 && (
                      <Text color={theme.colors.danger} bold>
                        {' '}
                        -{beat.damage}
                      </Text>
                    )}
                  </>
                )}
                <StatusTags statuses={enemy.statuses} />
              </Text>
              {/* Detail row: HP bar + telegraphed intent (icon + name + dmg). */}
              {alive && (
                <Text>
                  {'      '}
                  <Text>[</Text>
                  <Text color={theme.colors.hp}>{bar.filled}</Text>
                  <Text color={theme.colors.hpEmpty}>{bar.empty}</Text>
                  <Text>]</Text>
                  <Text color={theme.colors.intent[kind]}>
                    {'  '}next: {theme.intentIcons[kind]} {intentNameFor(content, enemy)}
                  </Text>
                  {intentChips(content, enemy).map((chip, ci) => (
                    <Text key={`${chip.text}-${ci}`} color={chip.color}>
                      {'  '}
                      {chip.text}
                    </Text>
                  ))}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{pending ? 'Choose a target:' : 'Your hand:'}</Text>
        <Box
          flexDirection="row"
          flexWrap="wrap"
          width={theme.layout.contentWidth}
        >
          {combat.hand.map((cardId, i) => {
            const card = content.cards[cardId];
            if (!card) return null;
            const affordable = card.cost <= combat.energy;
            return (
              <CardTile
                key={`${cardId}-${i}`}
                marker={`[${i + 1}]`}
                card={card}
                dim={!affordable}
                live={liveGradient(card, combat)}
              />
            );
          })}
        </Box>
      </Box>
      {state.potions.length > 0 && (
        <Box marginTop={1}>
          <Text>
            <Text color={theme.colors.accent}>Satchel:</Text>
            {state.potions.map((potionId, i) => {
              const potion = content.potions[potionId];
              const key = potionKeys[i] ?? '?';
              return (
                <Text key={`${potionId}-${i}`}>
                  {'  '}({key}) {potion?.name ?? potionId}
                </Text>
              );
            })}
          </Text>
        </Box>
      )}
    </Screen>
  );
}
