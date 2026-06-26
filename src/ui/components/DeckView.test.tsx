import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DeckView } from './DeckView.js';
import { createRun } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { RunState } from '../../engine/types.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

/** A RunState whose deck is exactly the given card ids. */
function withDeck(deck: readonly string[]): RunState {
  const base = createRun(content, 'deck-test', DEFAULT_RUN_CONFIG);
  return { ...base, deck: [...deck] };
}

const noop = () => undefined;

describe('DeckView', () => {
  it('shows each card effect description alongside name and grouped count', () => {
    const { lastFrame } = render(
      <DeckView
        state={withDeck(['rusty-shortsword', 'rusty-shortsword', 'battered-buckler'])}
        content={content}
        onClose={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    // Name + grouped count still show...
    expect(frame).toContain('Rusty Shortsword');
    expect(frame).toContain('x2');
    // ...and now the effect text is visible from the deck view (the #2 ask).
    expect(frame).toContain(content.cards['rusty-shortsword']!.description);
    expect(frame).toContain(content.cards['battered-buckler']!.description);
  });

  it('closes with esc and with v', async () => {
    let closed = 0;
    const { stdin } = render(
      <DeckView state={withDeck(['rusty-shortsword'])} content={content} onClose={() => closed++} />,
    );
    await tick();
    stdin.write('\x1b'); // escape
    await tick();
    expect(closed).toBe(1);
    stdin.write('v');
    await tick();
    expect(closed).toBe(2);
  });

  it('paginates a large deck with [n]/[p] and a page fits the row budget', async () => {
    // 24 distinct-ish entries (>= PER_PAGE of 12) to force >1 page.
    const ids = [
      'rusty-shortsword',
      'battered-buckler',
      'oath-keeper',
      'vanguard-stance',
      'spore-burst',
      'goblin-stomp',
      'cleave-the-horde',
      'weakening-jab',
      'second-breakfast',
      'shield-wall',
      'adrenaline-rush',
      'flurry-of-knives',
      'liquid-courage',
      'troll-blood',
      'lucky-dagger',
      'last-stand',
    ];
    // Duplicate to reach a 24-card deck; duplicates collapse so we keep distinct
    // ids to guarantee more rows than one page holds.
    const deck = [...ids, ...ids.slice(0, 8)];
    const { lastFrame, stdin } = render(
      <DeckView state={withDeck(deck)} content={content} onClose={noop} />,
    );
    await tick();
    const first = lastFrame() ?? '';
    // More entries than a page holds => pagination chrome appears.
    expect(first).toContain('page 1/2');
    expect(first).toContain('[n]ext');
    expect(first).toContain('[esc/v] close');
    // A full page must stay within the 30-row snapshot budget.
    expect(first.split('\n').length).toBeLessThanOrEqual(30);

    stdin.write('n');
    await tick();
    const second = lastFrame() ?? '';
    expect(second).toContain('page 2/2');
    expect(second.split('\n').length).toBeLessThanOrEqual(30);

    stdin.write('p');
    await tick();
    expect(lastFrame()).toContain('page 1/2');
  });
});
