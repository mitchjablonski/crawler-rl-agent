import { describe, expect, it } from 'vitest';
import { content } from '../engine/content/index.js';
import type { CardDef } from '../engine/types.js';
import { emptyManifest, extendManifest, manifestFingerprint, widthOf } from './vocab.js';

const MAXE = 4;
const MAXH = 10;
const sampleCard: CardDef = Object.values(content.cards)[0]!;

/** content with one extra card id appended (only keys matter to the manifest). */
function withExtraCard(id: string): typeof content {
  return { ...content, cards: { ...content.cards, [id]: sampleCard } };
}

describe('vocab manifest', () => {
  it('assigns every content id a dense slot from zero', () => {
    const m = extendManifest(emptyManifest(MAXE, MAXH), content, MAXE, MAXH);
    expect(widthOf(m.cards)).toBe(Object.keys(content.cards).length);
    const idxs = Object.values(m.cards).sort((a, b) => a - b);
    expect(idxs).toEqual(idxs.map((_, i) => i));
  });

  it('is append-only: existing indices are preserved when content grows', () => {
    const base = extendManifest(emptyManifest(MAXE, MAXH), content, MAXE, MAXH);
    const grown = extendManifest(base, withExtraCard('zzz-new-card'), MAXE, MAXH);
    for (const [id, idx] of Object.entries(base.cards)) {
      expect(grown.cards[id]).toBe(idx);
    }
    expect(grown.cards['zzz-new-card']).toBe(widthOf(base.cards));
    expect(widthOf(grown.cards)).toBe(widthOf(base.cards) + 1);
  });

  it('tombstones removed ids: indices and width are retained when content shrinks', () => {
    const base = extendManifest(emptyManifest(MAXE, MAXH), content, MAXE, MAXH);
    const firstId = Object.keys(content.cards).sort()[0]!;
    const shrunkCards = { ...content.cards };
    delete shrunkCards[firstId];
    const shrunk = extendManifest(base, { ...content, cards: shrunkCards }, MAXE, MAXH);
    expect(shrunk.cards[firstId]).toBe(base.cards[firstId]);
    expect(widthOf(shrunk.cards)).toBe(widthOf(base.cards));
  });

  it('fingerprint is stable across rebuilds but changes on a vocab change', () => {
    const a = extendManifest(emptyManifest(MAXE, MAXH), content, MAXE, MAXH);
    const b = extendManifest(emptyManifest(MAXE, MAXH), content, MAXE, MAXH);
    expect(manifestFingerprint(a)).toBe(manifestFingerprint(b));
    const grown = extendManifest(a, withExtraCard('zzz-new-card'), MAXE, MAXH);
    expect(manifestFingerprint(grown)).not.toBe(manifestFingerprint(a));
  });
});
