import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { RestScreen } from './RestScreen.js';
import { createRun } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { GameAction, RunState } from '../../engine/types.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

/** A RunState parked on a rest site with a chosen deck of upgradeable cards. */
function onRest(deck: readonly string[]): RunState {
  const base = createRun(content, 'rest-test', DEFAULT_RUN_CONFIG);
  return { ...base, phase: 'rest', deck: [...deck] };
}

const noop = () => undefined;

describe('RestScreen rest menu', () => {
  it('shows the heal and upgrade affordances with the upgradeable count', () => {
    const { lastFrame } = render(
      <RestScreen state={onRest(['rusty-shortsword'])} content={content} dispatch={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[r] Rest');
    expect(frame).toContain('[u] Upgrade a card');
    expect(frame).toContain('(1 upgradeable)');
  });
});

describe('RestScreen upgrade chooser shows base -> upgraded', () => {
  it('renders BOTH the current and upgraded effect per option', async () => {
    const { lastFrame, stdin } = render(
      <RestScreen
        state={onRest(['rusty-shortsword', 'battered-buckler'])}
        content={content}
        dispatch={noop}
      />,
    );
    await tick();
    stdin.write('u'); // open the upgrade chooser
    await tick();
    const frame = lastFrame() ?? '';

    // Card name + base AND upgraded effect both present so the delta is legible.
    expect(frame).toContain('Rusty Shortsword');
    expect(frame).toContain('Deal 6 damage.'); // current (base) effect
    expect(frame).toContain('Deal 9 damage.'); // upgraded effect
    expect(frame).toContain('Gain 5 Block.'); // second option, base
    expect(frame).toContain('Gain 8 Block.'); // second option, upgraded
    // The was/now framing makes which is which unambiguous.
    expect(frame).toContain('was');
    expect(frame).toContain('now');
    // Numbered selection markers preserved.
    expect(frame).toContain('[1]');
    expect(frame).toContain('[2]');
  });

  it('selecting option N dispatches upgradeCard for that deck index', async () => {
    const dispatch = vi.fn<(action: GameAction) => void>();
    const { stdin } = render(
      <RestScreen
        state={onRest(['rusty-shortsword', 'battered-buckler'])}
        content={content}
        dispatch={dispatch}
      />,
    );
    await tick();
    stdin.write('u');
    await tick();
    stdin.write('2'); // upgrade the second option
    await tick();
    expect(dispatch).toHaveBeenCalledWith({ type: 'upgradeCard', deckIndex: 1 });
  });

  it('paginates at PER_PAGE (6): 7 cards -> 6 on page 1, 1 on page 2', async () => {
    // Seven upgradeable cards -> 6 on page 1, 1 on page 2 (PER_PAGE = 6).
    const deck = Array.from({ length: 7 }, () => 'rusty-shortsword');
    const { lastFrame, stdin } = render(
      <RestScreen state={onRest(deck)} content={content} dispatch={noop} />,
    );
    await tick();
    stdin.write('u');
    await tick();
    const page1 = lastFrame() ?? '';
    expect(page1).toContain('page 1/2');
    // Page 1 fills to [6] but not a 7th option.
    expect(page1).toContain('[6]');
    expect(page1).not.toContain('[7]');

    stdin.write('n'); // next page
    await tick();
    const page2 = lastFrame() ?? '';
    expect(page2).toContain('page 2/2');
    // Page 2 has exactly one option ([1]) and no [2].
    expect(page2).toContain('[1]');
    expect(page2).not.toContain('[2]');
    // Still comparing base -> upgraded on the later page.
    expect(page2).toContain('Deal 6 damage.');
    expect(page2).toContain('Deal 9 damage.');
  });

  it('escape returns to the rest menu', async () => {
    const { lastFrame, stdin } = render(
      <RestScreen state={onRest(['rusty-shortsword'])} content={content} dispatch={noop} />,
    );
    await tick();
    stdin.write('u');
    await tick();
    expect(lastFrame() ?? '').toContain('Upgrade a card:');
    stdin.write('\x1b'); // ESC
    await tick();
    expect(lastFrame() ?? '').toContain('[r] Rest');
  });
});
