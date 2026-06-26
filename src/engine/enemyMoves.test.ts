import { describe, expect, it } from 'vitest';
import { resolveEnemyMove, resolveEnemyPool } from './enemyMoves.js';
import type { EnemyDef, EnemyInstance } from './types.js';

function inst(over: Partial<EnemyInstance> & Pick<EnemyInstance, 'hp' | 'maxHp' | 'nextMoveIndex'>): EnemyInstance {
  return {
    defId: 'x',
    name: 'X',
    block: 0,
    statuses: {},
    ...over,
  };
}

const phaseless: EnemyDef = {
  id: 'phaseless',
  name: 'Phaseless',
  hp: [10, 10],
  moves: [
    { name: 'A', effects: [{ kind: 'damage', amount: 1, target: 'enemy' }] },
    { name: 'B', effects: [{ kind: 'damage', amount: 2, target: 'enemy' }] },
    { name: 'C', effects: [{ kind: 'block', amount: 3 }] },
  ],
};

const phased: EnemyDef = {
  id: 'phased',
  name: 'Phased',
  hp: [40, 40],
  moves: [
    { name: 'Calm', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
    { name: 'Guard', effects: [{ kind: 'block', amount: 5 }] },
  ],
  phases: [
    {
      hpThreshold: 0.5,
      name: 'Enraged',
      moves: [
        { name: 'Signature', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }] },
        { name: 'Rage', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
      ],
    },
  ],
};

describe('resolveEnemyMove (phaseless)', () => {
  it('returns exactly moves[idx % len] (byte-identical to legacy behavior)', () => {
    for (let idx = 0; idx < 10; idx++) {
      const e = inst({ hp: 10, maxHp: 10, nextMoveIndex: idx });
      const legacy = phaseless.moves[idx % phaseless.moves.length];
      expect(resolveEnemyMove(phaseless, e)).toBe(legacy);
    }
  });

  it('the pool is identically the base move array', () => {
    const e = inst({ hp: 3, maxHp: 10, nextMoveIndex: 0 });
    expect(resolveEnemyPool(phaseless, e)).toBe(phaseless.moves);
  });
});

describe('resolveEnemyMove (phased boss)', () => {
  it('uses the base pool above the threshold', () => {
    const e = inst({ hp: 30, maxHp: 40, nextMoveIndex: 0 }); // 75%
    expect(resolveEnemyPool(phased, e)).toBe(phased.moves);
    expect(resolveEnemyMove(phased, e)?.name).toBe('Calm');
  });

  it('switches to the enraged pool at/under the threshold and surfaces the signature', () => {
    const e = inst({ hp: 20, maxHp: 40, nextMoveIndex: 0 }); // exactly 50%
    expect(resolveEnemyPool(phased, e)).toBe(phased.phases![0]!.moves);
    expect(resolveEnemyMove(phased, e)?.name).toBe('Signature');

    const below = inst({ hp: 5, maxHp: 40, nextMoveIndex: 1 });
    expect(resolveEnemyMove(phased, below)?.name).toBe('Rage');
  });

  it('indexes the active pool by nextMoveIndex (modulo the active pool length)', () => {
    // index 2 wraps: base pool len 2 -> Calm; enraged pool len 2 -> Signature.
    const high = inst({ hp: 40, maxHp: 40, nextMoveIndex: 2 });
    expect(resolveEnemyMove(phased, high)?.name).toBe('Calm');
    const low = inst({ hp: 10, maxHp: 40, nextMoveIndex: 2 });
    expect(resolveEnemyMove(phased, low)?.name).toBe('Signature');
  });
});
