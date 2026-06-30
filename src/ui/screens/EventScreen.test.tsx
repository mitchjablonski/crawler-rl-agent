import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { EventScreen, optionHintSegments } from './EventScreen.js';
import { createRun } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { EventOutcome, RunState, SimpleEventOutcome } from '../../engine/types.js';

/** Flatten hint segments to plain text for assertions. */
function hintText(outcomes: readonly EventOutcome[]): string {
  return optionHintSegments(outcomes, content)
    .map((s) => s.text)
    .join('');
}

/** A RunState parked on a specific event in the option (pre-resolution) view. */
function onEvent(eventId: string, overrides: Partial<RunState> = {}): RunState {
  const base = createRun(content, 'event-test', DEFAULT_RUN_CONFIG);
  return { ...base, phase: 'event', event: { eventId }, ...overrides };
}

/** A RunState parked on an event's RESULT (post-resolution) view. */
function onResult(
  eventId: string,
  applied: readonly SimpleEventOutcome[],
  rolled = false,
  overrides: Partial<RunState> = {},
): RunState {
  const base = createRun(content, 'event-result-test', DEFAULT_RUN_CONFIG);
  return {
    ...base,
    phase: 'event',
    event: { eventId, result: { applied, rolled } },
    ...overrides,
  };
}

const noop = () => undefined;

/** Yield a macrotask so Ink's useInput effect can (un)subscribe to stdin. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('optionHintSegments (hint model)', () => {
  it('deterministic option shows signed HP and gold concretely', () => {
    const text = hintText([
      { kind: 'loseHp', amount: 6 },
      { kind: 'gainGold', amount: 30 },
    ]);
    expect(text).toContain('-6 HP');
    expect(text).toContain('+30g');
  });

  it('rollOutcomes shows a gold RANGE (min..max), not a single roll', () => {
    const text = hintText([
      {
        kind: 'rollOutcomes',
        branches: [
          [{ kind: 'gainGold', amount: 55 }],
          [{ kind: 'gainGold', amount: 20 }],
          [{ kind: 'loseHp', amount: 8 }],
        ],
      },
    ]);
    // Gold spans 0 (the HP branch) up to +55.
    expect(text).toContain('+0..+55g');
    // HP spans -8 (the bite-back branch) up to 0.
    expect(text).toContain('-8..+0 HP');
  });

  it('conditional shows the gate and both clauses', () => {
    const text = hintText([
      {
        kind: 'conditional',
        check: 'relics',
        atLeast: 3,
        ifPass: [{ kind: 'loseHp', amount: 2 }],
        ifFail: [{ kind: 'loseHp', amount: 9 }],
      },
    ]);
    expect(text).toContain('if relics>=3:');
    expect(text).toContain('-2 HP');
    expect(text).toContain('else');
    expect(text).toContain('-9 HP');
  });

  it('a card grant shows the card NAME, not the id', () => {
    const text = hintText([{ kind: 'gainCard', cardId: 'lucky-dagger' }]);
    const name = content.cards['lucky-dagger']?.name ?? 'lucky-dagger';
    expect(text).toContain(`+${name}`);
    expect(text).not.toContain('lucky-dagger');
  });

  it('a relic grant shows the relic NAME', () => {
    const text = hintText([{ kind: 'gainRelic', relicId: 'whetstone' }]);
    const name = content.relics['whetstone']?.name ?? 'whetstone';
    expect(text).toContain(`+${name}`);
  });

  it('a card present in only some roll branches reads as "maybe"', () => {
    const text = hintText([
      {
        kind: 'rollOutcomes',
        branches: [
          [{ kind: 'gainCard', cardId: 'lucky-dagger' }],
          [{ kind: 'loseHp', amount: 9 }],
        ],
      },
    ]);
    const name = content.cards['lucky-dagger']?.name ?? 'lucky-dagger';
    expect(text).toContain(`(${name})`); // parenthesised => not guaranteed
  });

  it('an empty-outcome option yields no hint', () => {
    expect(optionHintSegments([], content)).toHaveLength(0);
  });

  // #34: hints must reflect the SCALED loseHp so the displayed stakes stay honest
  // at hard/nightmare. Default mult (1) keeps the hint byte-identical to base.
  it('scales the loseHp hint at hard (×1.25) and nightmare (×1.5)', () => {
    const mk = (mult: number) =>
      optionHintSegments([{ kind: 'loseHp', amount: 8 }], content, mult)
        .map((s) => s.text)
        .join('');
    expect(mk(1)).toContain('-8 HP'); // normal: unchanged
    expect(mk(1.25)).toContain('-10 HP'); // floor(8*1.25)
    expect(mk(1.5)).toContain('-12 HP'); // floor(8*1.5)
  });

  it('scales the loseHp side of a roll RANGE but not the gains', () => {
    const text = optionHintSegments(
      [
        {
          kind: 'rollOutcomes',
          branches: [[{ kind: 'gainGold', amount: 55 }], [{ kind: 'loseHp', amount: 8 }]],
        },
      ],
      content,
      1.5,
    )
      .map((s) => s.text)
      .join('');
    expect(text).toContain('+0..+55g'); // gold unscaled
    expect(text).toContain('-12..+0 HP'); // HP scaled (floor(8*1.5)=12)
  });
});

describe('EventScreen option view renders hints', () => {
  it('renders an outcome hint under a risky (roll) option', () => {
    const { lastFrame } = render(
      <EventScreen
        state={onEvent('abandoned-vending-machine')}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Kick it until something falls out');
    // The roll range surfaces the stakes without revealing the roll.
    expect(frame).toContain('+0..+55g');
    // "Walk away" (empty outcomes) shows the label but no numeric hint on it.
    expect(frame).toContain('Walk away');
  });

  it('still shows the gated reason on a stat-gated option', () => {
    const { lastFrame } = render(
      <EventScreen
        state={onEvent('goblin-toll-booth', { gold: 0 })}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Pay the toll');
    expect(frame).toContain('need 30 gold');
  });
});

describe('EventScreen result view shows aftermath flavor', () => {
  it('renders the per-event WIN aftermath when the net outcome is favorable', () => {
    // Shrine "tithe and pray": lose gold but gain max HP → net win.
    const { lastFrame } = render(
      <EventScreen
        state={onResult('shrine-of-the-crawl', [
          { kind: 'loseGold', amount: 20 },
          { kind: 'gainMaxHp', amount: 6 },
        ])}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    const aftermath = content.events['shrine-of-the-crawl']?.aftermath;
    expect(aftermath).toBeTruthy();
    expect(frame).toContain(aftermath!.win);
    // The outcomes themselves are still shown above the flavor.
    expect(frame).toContain('+6 max HP');
    // The continue action is preserved.
    expect(frame).toContain('[1] Continue');
  });

  it('renders the per-event LOSS aftermath when the net outcome is unfavorable', () => {
    // A pure-cost resolution (only an HP loss) → net loss.
    const { lastFrame } = render(
      <EventScreen
        state={onResult('shrine-of-the-crawl', [{ kind: 'loseHp', amount: 9 }])}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    const aftermath = content.events['shrine-of-the-crawl']?.aftermath;
    expect(frame).toContain(aftermath!.loss);
  });

  it('a card/relic grant reads as a WIN even when paired with an HP toll', () => {
    // Armory "take everything": gains content but bleeds → still a win.
    const { lastFrame } = render(
      <EventScreen
        state={onResult('abandoned-armory', [
          { kind: 'gainRelic', relicId: 'whetstone' },
          { kind: 'loseHp', amount: 18 },
        ])}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(content.events['abandoned-armory']!.aftermath!.win);
  });

  // #50: the result view echoes the player's choice for recall (esp. after a
  // rolled outcome). Tracked in component state at press time — no RunState/save
  // change — so it shows only when the same component instance saw the press.
  it('shows "You chose: <label>" after the player picks an option, then resolves', async () => {
    const inst = render(
      <EventScreen
        state={onEvent('shrine-of-the-crawl')}
        content={content}
        dispatch={noop}
      />,
    );
    await tick(); // let useInput's effect subscribe before we press
    // Press option [1] ("Tithe and pray") — records the choice in the component.
    inst.stdin.write('1');
    await tick();
    const label = content.events['shrine-of-the-crawl']!.options[0]!.label;
    // Same instance now re-renders parked on that event's result view.
    inst.rerender(
      <EventScreen
        state={onResult('shrine-of-the-crawl', [
          { kind: 'loseGold', amount: 20 },
          { kind: 'gainMaxHp', amount: 6 },
        ])}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = inst.lastFrame() ?? '';
    expect(frame).toContain(`You chose: ${label}`);
    // The rest of the result is intact.
    expect(frame).toContain('It is done.');
    expect(frame).toContain('[1] Continue');
  });

  it('shows no recall line on a fresh result with no recorded choice (resume edge)', () => {
    // A component mounted straight onto a result (as a save+resume would) has no
    // recorded press → it must omit the line, never crash.
    const { lastFrame } = render(
      <EventScreen
        state={onResult('shrine-of-the-crawl', [{ kind: 'loseHp', amount: 9 }])}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('You chose:');
    // The result still renders normally.
    expect(frame).toContain('It is done.');
  });

  it('does not show a stale label for a different event than the one chosen', async () => {
    const inst = render(
      <EventScreen
        state={onEvent('shrine-of-the-crawl')}
        content={content}
        dispatch={noop}
      />,
    );
    await tick(); // let useInput's effect subscribe before we press
    inst.stdin.write('1'); // recorded against shrine-of-the-crawl
    await tick();
    // Re-render the same instance on a DIFFERENT event's result → the recorded
    // choice belongs to another event, so no recall line.
    inst.rerender(
      <EventScreen
        state={onResult('abandoned-armory', [{ kind: 'loseHp', amount: 18 }])}
        content={content}
        dispatch={noop}
      />,
    );
    expect(inst.lastFrame() ?? '').not.toContain('You chose:');
  });

  it('falls back to a deterministic valence-bank line when the event authors none', () => {
    // Build a synthetic event with NO aftermath field; the screen should still
    // close the loop with a generic valence line (and pick it deterministically).
    const synthetic = {
      ...content,
      events: {
        'no-aftermath': {
          id: 'no-aftermath',
          name: 'A Plain Room',
          prompt: 'Nothing of note.',
          options: [{ label: 'Leave', outcomes: [] }],
        },
      },
    };
    const render1 = render(
      <EventScreen
        state={onResult('no-aftermath', [{ kind: 'gainGold', amount: 30 }])}
        content={synthetic}
        dispatch={noop}
      />,
    );
    const frame1 = render1.lastFrame() ?? '';
    // A non-empty flavor line is present (a generic win line), and it's stable
    // across renders of the same resolution.
    const render2 = render(
      <EventScreen
        state={onResult('no-aftermath', [{ kind: 'gainGold', amount: 30 }])}
        content={synthetic}
        dispatch={noop}
      />,
    );
    expect(frame1).toContain('You pocket your luck before it changes its mind.');
    expect(render2.lastFrame()).toBe(frame1);
  });
});
