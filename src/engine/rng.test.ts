import { describe, expect, it } from 'vitest';
import { Rng, initStreams, seedFromString, withStream } from './rng.js';

describe('Rng', () => {
  it('produces an identical sequence from the same state', () => {
    const a = new Rng(seedFromString('hello'));
    const b = new Rng(seedFromString('hello'));
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0, 1) and int stays in range', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.intBetween(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('shuffle returns a permutation and is deterministic', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new Rng(7).shuffle(input);
    const b = new Rng(7).shuffle(input);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input untouched
  });
});

describe('streams', () => {
  it('seeds each stream independently', () => {
    const streams = initStreams('run-1');
    const values = new Set(Object.values(streams));
    expect(values.size).toBe(Object.keys(streams).length);
  });

  it('withStream advances only the named stream', () => {
    const streams = initStreams('run-1');
    const [, next] = withStream(streams, 'combat', (rng) => rng.next());
    expect(next.combat).not.toBe(streams.combat);
    expect(next.map).toBe(streams.map);
    expect(next.loot).toBe(streams.loot);
  });

  it('different seeds give different streams', () => {
    expect(initStreams('a')).not.toEqual(initStreams('b'));
  });
});
