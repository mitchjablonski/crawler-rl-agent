import { Box, Text, useInput } from 'ink';
import type {
  ContentRegistry,
  EventCheck,
  EventOutcome,
  EventRequirement,
  GameAction,
  RunState,
  SimpleEventOutcome,
} from '../../engine/types.js';
import { eventRequirementMet } from '../../engine/types.js';
import { theme } from '../theme.js';
import type { InkColor } from '../theme.js';
import { Screen } from '../components/Screen.js';

/** Human-readable noun for the field a requirement gates on. */
const CHECK_NOUN: Readonly<Record<EventCheck, string>> = {
  gold: 'gold',
  hp: 'HP',
  maxHp: 'max HP',
  relics: 'relics',
  deck: 'cards',
};

function requireReason(requires: EventRequirement): string {
  return `need ${requires.atLeast} ${CHECK_NOUN[requires.check]}`;
}

// ---- Outcome hints (read-only derivation of the static event definition) ----
//
// A hint reveals the STAKES of an option (which dimensions move, and — for a
// gamble — the RANGE), never the resolved roll: the engine still rolls at
// choice time, so suspense is preserved while the player regains agency.
//
// Hint model per outcome kind:
//   - simple (deterministic): the outcome is fixed → show it concretely.
//   - rollOutcomes (a gamble): show min..max PER DIMENSION across branches; a
//     card/relic present in only some branches reads as "maybe" (parenthesised).
//   - conditional (stat-gated): show both clauses compactly (`if relics>=3 …`).

/** One colored fragment of a hint line. */
interface HintSegment {
  readonly text: string;
  readonly color: InkColor;
}

/** Signed integer, e.g. 5 -> "+5", -3 -> "-3". */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Token color for a numeric dimension: gains success, losses danger, 0 muted. */
function deltaColor(n: number): InkColor {
  if (n > 0) return theme.colors.success;
  if (n < 0) return theme.colors.danger;
  return theme.colors.muted;
}

/** Resolve a card/relic id to its display name (falls back to the id). */
function nameOf(outcome: SimpleEventOutcome, content: ContentRegistry): string {
  if (outcome.kind === 'gainCard') return content.cards[outcome.cardId]?.name ?? outcome.cardId;
  if (outcome.kind === 'gainRelic') return content.relics[outcome.relicId]?.name ?? outcome.relicId;
  return '';
}

/**
 * The signed numeric delta a SINGLE simple outcome contributes to each numeric
 * dimension (gold / hp / maxHp). Card/relic grants contribute nothing here —
 * they are summarized separately by name.
 */
function numericDelta(
  outcome: SimpleEventOutcome,
  loseHpMult: number,
): {
  readonly gold: number;
  readonly hp: number;
  readonly maxHp: number;
} {
  switch (outcome.kind) {
    case 'gainGold':
      return { gold: outcome.amount, hp: 0, maxHp: 0 };
    case 'loseGold':
      return { gold: -outcome.amount, hp: 0, maxHp: 0 };
    case 'loseHp':
      // #34: the engine scales event loseHp by the difficulty knob (then caps at
      // 40% of current HP). Show the SCALED amount so the stated stakes match
      // reality; on normal (mult 1) this is byte-identical to the base value.
      // The cap is HP-dependent so the hint shows the uncapped ceiling.
      return { gold: 0, hp: -Math.floor(outcome.amount * loseHpMult), maxHp: 0 };
    case 'gainMaxHp':
      return { gold: 0, hp: 0, maxHp: outcome.amount };
    default:
      return { gold: 0, hp: 0, maxHp: 0 };
  }
}

/** Sum the numeric deltas of a flat list of simple outcomes (one branch/clause). */
function sumNumeric(
  outcomes: readonly SimpleEventOutcome[],
  loseHpMult: number,
): {
  readonly gold: number;
  readonly hp: number;
  readonly maxHp: number;
} {
  return outcomes.reduce(
    (acc, o) => {
      const d = numericDelta(o, loseHpMult);
      return { gold: acc.gold + d.gold, hp: acc.hp + d.hp, maxHp: acc.maxHp + d.maxHp };
    },
    { gold: 0, hp: 0, maxHp: 0 },
  );
}

/** Card/relic display names granted by a flat list of simple outcomes. */
function grantNames(
  outcomes: readonly SimpleEventOutcome[],
  content: ContentRegistry,
): readonly string[] {
  return outcomes
    .filter((o) => o.kind === 'gainCard' || o.kind === 'gainRelic')
    .map((o) => nameOf(o, content));
}

/** A segment for a fixed numeric dimension, e.g. `+30g` / `-6 HP`. Null if 0. */
function fixedNumSegment(n: number, suffix: string): HintSegment | null {
  if (n === 0) return null;
  return { text: `${signed(n)}${suffix}`, color: deltaColor(n) };
}

/**
 * A segment for a RANGE on a numeric dimension across roll branches, e.g.
 * `+20..+55g` (mixed sign reads as `-8..+55g`). Null if the whole range is 0.
 * Colored by the better edge so an upside still reads as success.
 */
function rangeNumSegment(min: number, max: number, suffix: string): HintSegment | null {
  if (min === 0 && max === 0) return null;
  if (min === max) return fixedNumSegment(min, suffix);
  const color = max > 0 ? theme.colors.success : theme.colors.danger;
  return { text: `${signed(min)}..${signed(max)}${suffix}`, color };
}

/**
 * Build the hint segments for one option's full outcome list. Composite kinds
 * are handled inline so a single option can mix a deterministic part with a
 * roll/conditional part (as authored events do). Returns [] for no hint.
 */
export function optionHintSegments(
  outcomes: readonly EventOutcome[],
  content: ContentRegistry,
  loseHpMult = 1,
): readonly HintSegment[] {
  const segments: HintSegment[] = [];
  const sep: HintSegment = { text: ', ', color: theme.colors.muted };
  const push = (seg: HintSegment | null) => {
    if (!seg) return;
    if (segments.length > 0) segments.push(sep);
    segments.push(seg);
  };

  // 1) Deterministic part: aggregate every plain simple outcome at the top level.
  const simple = outcomes.filter(
    (o): o is SimpleEventOutcome =>
      o.kind !== 'rollOutcomes' && o.kind !== 'conditional',
  );
  const fixed = sumNumeric(simple, loseHpMult);
  push(fixedNumSegment(fixed.gold, 'g'));
  push(fixedNumSegment(fixed.hp, ' HP'));
  push(fixedNumSegment(fixed.maxHp, ' max HP'));
  for (const name of grantNames(simple, content)) {
    push({ text: `+${name}`, color: theme.colors.success });
  }

  // 2) Composite parts, in author order.
  for (const o of outcomes) {
    if (o.kind === 'rollOutcomes') {
      const sums = o.branches.map((b) => sumNumeric(b, loseHpMult));
      const range = (sel: (s: { gold: number; hp: number; maxHp: number }) => number) => ({
        min: Math.min(...sums.map(sel)),
        max: Math.max(...sums.map(sel)),
      });
      const g = range((s) => s.gold);
      const h = range((s) => s.hp);
      const m = range((s) => s.maxHp);
      push(rangeNumSegment(g.min, g.max, 'g'));
      push(rangeNumSegment(h.min, h.max, ' HP'));
      push(rangeNumSegment(m.min, m.max, ' max HP'));
      // Card/relic grants: present in every branch -> sure; otherwise "maybe".
      const counts = new Map<string, number>();
      for (const branch of o.branches) {
        for (const name of grantNames(branch, content)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      for (const [name, count] of counts) {
        const sure = count === o.branches.length;
        push({
          text: sure ? `+${name}` : `(${name})`,
          color: theme.colors.success,
        });
      }
    } else if (o.kind === 'conditional') {
      // Show the gate and both clauses compactly: `if relics>=3: -2 HP else -9 HP`.
      const clause = (cl: readonly SimpleEventOutcome[]) => {
        const n = sumNumeric(cl, loseHpMult);
        const parts: string[] = [];
        if (n.gold !== 0) parts.push(`${signed(n.gold)}g`);
        if (n.hp !== 0) parts.push(`${signed(n.hp)} HP`);
        if (n.maxHp !== 0) parts.push(`${signed(n.maxHp)} max HP`);
        for (const name of grantNames(cl, content)) parts.push(`+${name}`);
        return parts.length > 0 ? parts.join(' ') : 'nothing';
      };
      push({
        text: `if ${CHECK_NOUN[o.check]}>=${o.atLeast}: ${clause(o.ifPass)} else ${clause(o.ifFail)}`,
        color: theme.colors.muted,
      });
    }
  }

  return segments;
}

/**
 * Render hint segments as a single dim, indented sub-line under an option. The
 * indent aligns the hint under the option label (past the `[N] ` gutter); the
 * wrapping Box bounds it to the content width so a many-dimension hint wraps
 * rather than overrunning 76 cols.
 */
function HintLine({ segments }: { readonly segments: readonly HintSegment[] }) {
  return (
    <Box width={theme.layout.contentWidth - 2} marginLeft={4}>
      <Text wrap="wrap" dimColor>
        {segments.map((seg, i) => (
          <Text key={i} color={seg.color}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** Format one applied outcome as a styled line. */
function outcomeLine(outcome: SimpleEventOutcome, content: ContentRegistry): {
  readonly text: string;
  readonly good: boolean;
} {
  switch (outcome.kind) {
    case 'gainGold':
      return { text: `+${outcome.amount} gold`, good: true };
    case 'loseGold':
      return { text: `-${outcome.amount} gold`, good: false };
    case 'loseHp':
      return { text: `-${outcome.amount} HP`, good: false };
    case 'gainMaxHp':
      return { text: `+${outcome.amount} max HP`, good: true };
    case 'gainCard': {
      const name = content.cards[outcome.cardId]?.name ?? outcome.cardId;
      return { text: `Added ${name} to your deck`, good: true };
    }
    case 'gainRelic': {
      const name = content.relics[outcome.relicId]?.name ?? outcome.relicId;
      return { text: `Acquired ${name}`, good: true };
    }
  }
}

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
  const result = state.event?.result;

  useInput((input, key) => {
    if (result) {
      if (input === '1' || key.return) dispatch({ type: 'continueEvent' });
      return;
    }
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      const option = options[n - 1];
      if (option && eventRequirementMet(state, option.requires)) {
        dispatch({ type: 'chooseEventOption', index: n - 1 });
      }
    }
  });

  if (!def) return null;

  // ---- Result view ----
  if (result) {
    const header = result.rolled ? 'The dice come up...' : 'It is done.';
    return (
      <Screen title={def.name} footer="[1] Continue" framed={false}>
        <Text color={theme.colors.accent}>{header}</Text>
        <Box marginTop={1} flexDirection="column">
          {result.applied.map((outcome, i) => {
            const line = outcomeLine(outcome, content);
            // The text already carries its own sign / verb; color conveys
            // gain vs loss — no extra +/- bullet (avoids a doubled sign).
            return (
              <Text key={i} color={line.good ? theme.colors.success : theme.colors.danger}>
                {line.text}
              </Text>
            );
          })}
        </Box>
      </Screen>
    );
  }

  // ---- Option view ----
  return (
    <Screen title={def.name} footer="press a number to choose" framed={false}>
      <Box width={theme.layout.contentWidth - 2}>
        <Text wrap="wrap">{def.prompt}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, i) => {
          const available = eventRequirementMet(state, option.requires);
          // Outcome hint: a read-only summary of the option's STAKES (range for
          // a gamble), shown as a dim sub-line so the player has agency without
          // the resolved roll being spoiled. Empty outcomes ("Walk away") -> none.
          const hint = optionHintSegments(option.outcomes, content, state.eventLoseHpMult);
          if (!available) {
            // Keep the real number (dimmed) so locked/unlocked rows align in
            // one column; pressing it is a no-op (guarded in useInput).
            return (
              <Box key={i} flexDirection="column">
                <Text color={theme.colors.muted}>
                  [{i + 1}] {option.label} ({option.requires ? requireReason(option.requires) : 'unavailable'})
                </Text>
                {hint.length > 0 && <HintLine segments={hint} />}
              </Box>
            );
          }
          return (
            <Box key={i} flexDirection="column">
              <Text>
                [{i + 1}] {option.label}
              </Text>
              {hint.length > 0 && <HintLine segments={hint} />}
            </Box>
          );
        })}
      </Box>
    </Screen>
  );
}
