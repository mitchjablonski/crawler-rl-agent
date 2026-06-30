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

  it('marks upgradeable cards with ^ and does NOT mark already-upgraded ones', () => {
    // rusty-shortsword HAS an upgradeTo (upgradeable -> marked); its -plus leaf
    // has no upgradeTo (already upgraded -> not marked).
    const upgradedId = content.cards['rusty-shortsword']!.upgradeTo!;
    const { lastFrame } = render(
      <DeckView
        state={withDeck(['rusty-shortsword', upgradedId])}
        content={content}
        onClose={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const baseLine = lines.find((l) => l.includes('Rusty Shortsword') && !l.includes('[+]')) ?? '';
    const upgradedLine = lines.find((l) => l.includes('[+]')) ?? '';
    // Upgradeable base card carries the accent ^ marker after its name.
    expect(baseLine).toContain('^');
    // The already-upgraded (-plus) leaf shows [+] but NOT the ^ marker.
    expect(upgradedLine).toContain('[+]');
    expect(upgradedLine).not.toContain('^');
  });

  it('marker count matches the rest-site upgradeable rule', () => {
    // A mixed deck: two upgradeable bases + one upgraded leaf + duplicates.
    const deck = [
      'rusty-shortsword',
      'rusty-shortsword', // duplicate collapses to one row
      'battered-buckler',
      content.cards['rusty-shortsword']!.upgradeTo!, // upgraded leaf, not markable
    ];
    // Rest-site rule (RestScreen.upgradeable): card.upgradeTo set AND it resolves.
    const expectedMarked = new Set(
      deck.filter((id) => {
        const c = content.cards[id];
        return c?.upgradeTo !== undefined && content.cards[c.upgradeTo] !== undefined;
      }),
    ).size; // distinct ids that are markable -> distinct rows that get a ^
    const { lastFrame } = render(
      <DeckView state={withDeck(deck)} content={content} onClose={noop} />,
    );
    const frame = lastFrame() ?? '';
    // Count rows (lines) that carry the ^ marker; one per distinct markable id.
    const marked = frame.split('\n').filter((l) => l.includes(' ^')).length;
    expect(marked).toBe(expectedMarked);
    expect(marked).toBe(2); // rusty-shortsword + battered-buckler
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

/** A combat RunState with the given hand/draw/discard piles (#56). */
function inCombat(
  hand: readonly string[],
  drawPile: readonly string[],
  discardPile: readonly string[],
): RunState {
  const base = createRun(content, 'combat-deck-test', DEFAULT_RUN_CONFIG);
  return {
    ...base,
    phase: 'combat',
    combat: {
      enemies: [],
      hand: [...hand],
      drawPile: [...drawPile],
      discardPile: [...discardPile],
      energy: 3,
      maxEnergy: 3,
      playerHp: base.hp,
      playerMaxHp: base.maxHp,
      playerBlock: 0,
      playerStatuses: {},
      turn: 1,
      dealt: 0,
      taken: 0,
      slain: 0,
    },
  };
}

describe('DeckView in combat (#56)', () => {
  it('shows the pile summary and tags each card by its pile (hand/draw/disc)', () => {
    const { lastFrame } = render(
      <DeckView
        state={inCombat(
          ['rusty-shortsword', 'battered-buckler'], // hand
          ['rusty-shortsword', 'rusty-shortsword'], // draw
          ['battered-buckler'], // discard
        )}
        content={content}
        onClose={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    // Title carries the live pile split (draw 2 | hand 2 | discard 1).
    expect(frame).toContain('draw 2');
    expect(frame).toContain('hand 2');
    expect(frame).toContain('discard 1');
    // Rows are tagged by pile so the player sees WHERE each card sits. The
    // discard tag is spelled out in full (#60), no longer the `disc` abbrev.
    expect(frame).toContain('hand');
    expect(frame).toContain('draw');
    expect(frame).toContain('discard');
    // The map-mode whole-deck title is NOT used in combat.
    expect(frame).not.toContain('cards)');
  });
});
