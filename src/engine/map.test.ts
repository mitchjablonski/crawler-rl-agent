import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from './rng.js';
import { MAX_CHOICE_ROWS, MIN_CHOICE_ROWS, generateMap } from './map.js';
import type { RunMap } from './types.js';

function reachable(map: RunMap): Set<string> {
  const seen = new Set<string>([map.startId]);
  const queue = [map.startId];
  while (queue.length > 0) {
    const node = map.nodes[queue.shift() as string];
    for (const next of node?.next ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('generateMap', () => {
  const MIN_NODES = MIN_CHOICE_ROWS * 2 + 3;
  const MAX_NODES = MAX_CHOICE_ROWS * 2 + 3;

  it('holds its invariants across 1000 seeds', () => {
    for (let i = 0; i < 1000; i++) {
      const tempo = (i % 11) / 10;
      const map = generateMap(new Rng(seedFromString(`map-${i}`)), {
        tempoHint: tempo,
      });
      const ids = Object.keys(map.nodes);

      expect(ids.length).toBeGreaterThanOrEqual(MIN_NODES);
      expect(ids.length).toBeLessThanOrEqual(MAX_NODES);

      // Every node reachable from start.
      expect(reachable(map).size).toBe(ids.length);

      // Only the boss is terminal.
      for (const node of Object.values(map.nodes)) {
        if (node.next.length === 0) expect(node.id).toBe(map.bossId);
      }

      // First choice row is always combat.
      for (const node of Object.values(map.nodes)) {
        if (node.row === 1) expect(node.kind).toBe('combat');
      }

      // No elites in the opening rows (new-player safety floor).
      for (const node of Object.values(map.nodes)) {
        if (node.kind === 'elite') expect(node.row).toBeGreaterThanOrEqual(3);
      }

      // Penultimate row is the rest site; boss is last.
      const bossRow = map.nodes[map.bossId]?.row ?? 0;
      const restNodes = Object.values(map.nodes).filter((n) => n.row === bossRow - 1);
      expect(restNodes).toHaveLength(1);
      expect(restNodes[0]?.kind).toBe('rest');

      // Gold always has a sink.
      expect(Object.values(map.nodes).some((n) => n.kind === 'shop')).toBe(true);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateMap(new Rng(123), { tempoHint: 0.5 });
    const b = generateMap(new Rng(123), { tempoHint: 0.5 });
    expect(a).toEqual(b);
  });

  it('single mode (acts:1) is byte-identical to the default', () => {
    const def = generateMap(new Rng(999), { tempoHint: 0.5 });
    const one = generateMap(new Rng(999), { tempoHint: 0.5, acts: 1 });
    expect(one).toEqual(def);
  });

  it('arc mode chains 3 acts into a larger, fully-reachable map', () => {
    for (let i = 0; i < 200; i++) {
      const map = generateMap(new Rng(seedFromString(`arc-${i}`)), {
        tempoHint: 0.5,
        acts: 3,
      });
      const nodes = Object.values(map.nodes);
      // Everything reachable from start.
      expect(reachable(map).size).toBe(nodes.length);
      // Exactly one boss, and it is the unique terminal + the deepest node.
      const bosses = nodes.filter((n) => n.kind === 'boss');
      expect(bosses).toHaveLength(1);
      expect(bosses[0]?.id).toBe(map.bossId);
      expect(map.nodes[map.bossId]?.next).toHaveLength(0);
      const maxRow = Math.max(...nodes.map((n) => n.row));
      expect(map.nodes[map.bossId]?.row).toBe(maxRow);
      // At least the two non-final act-boss elites exist.
      expect(nodes.filter((n) => n.kind === 'elite').length).toBeGreaterThanOrEqual(2);
      // Bigger than a single act on the same seed.
      const single = generateMap(new Rng(seedFromString(`arc-${i}`)), {
        tempoHint: 0.5,
        acts: 1,
      });
      expect(nodes.length).toBeGreaterThan(Object.keys(single.nodes).length);
    }
  });
});
