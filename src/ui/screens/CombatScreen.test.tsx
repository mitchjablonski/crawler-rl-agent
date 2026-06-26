import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { CombatScreen } from './CombatScreen.js';
import { createRun } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { CombatState, EnemyInstance, RunState } from '../../engine/types.js';

/** Build a single-enemy combat RunState whose lone enemy is on `nextMoveIndex`. */
function combatWith(defId: string, nextMoveIndex: number): RunState {
  const base = createRun(content, 'intent-test', DEFAULT_RUN_CONFIG);
  const def = content.enemies[defId];
  if (!def) throw new Error(`unknown enemy ${defId}`);
  const enemy: EnemyInstance = {
    defId,
    name: def.name,
    hp: def.hp[1],
    maxHp: def.hp[1],
    block: 0,
    statuses: {},
    nextMoveIndex,
  };
  const combat: CombatState = {
    enemies: [enemy],
    hand: [],
    drawPile: [],
    discardPile: [],
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
  };
  return { ...base, phase: 'combat', combat };
}

/** Same combat with the lone enemy's hp overridden (to simulate a hit/kill). */
function withEnemyHp(state: RunState, hp: number): RunState {
  const combat = state.combat as CombatState;
  const enemy = combat.enemies[0] as EnemyInstance;
  return {
    ...state,
    combat: { ...combat, enemies: [{ ...enemy, hp }] },
  };
}

const noop = () => {};

describe('CombatScreen intent telegraph', () => {
  it('shows BOTH the damage and the debuff chip for a multi-effect move', () => {
    // Lint Goblin move 1 = Style Violation: 9 damage + apply 2 Vulnerable to player.
    const { lastFrame } = render(
      <CombatScreen
        state={combatWith('lint-goblin', 1)}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('next:');
    expect(frame).toContain('Style Violation');
    expect(frame).toContain('9dmg'); // headline threat
    // Canonical status format (V5): identity color + `<ICON> <N>` with a space,
    // unified across enemy tags, player statuses, and intent chips (was `VUL2`).
    expect(frame).toContain('VUL 2'); // the debuff landing on the player
  });

  it('shows a multi-hit damage chip as NxTdmg', () => {
    // Lint Goblin move 0 = Nitpick: 4 damage x2.
    const { lastFrame } = render(
      <CombatScreen
        state={combatWith('lint-goblin', 0)}
        content={content}
        dispatch={noop}
      />,
    );
    expect(lastFrame() ?? '').toContain('4x2dmg');
  });

  it('shows a +Nblk chip for a pure-block move', () => {
    // Skeleton Intern move 1 = Coffee Break: block 6.
    const { lastFrame } = render(
      <CombatScreen
        state={combatWith('skeleton-intern', 1)}
        content={content}
        dispatch={noop}
      />,
    );
    expect(lastFrame() ?? '').toContain('+6blk');
  });

  it('shows a self-buff chip (ICON+N) for a buff move', () => {
    // Lint Goblin move 2 = Refactor Rage: block 8 + gain 1 Strength (self).
    const { lastFrame } = render(
      <CombatScreen
        state={combatWith('lint-goblin', 2)}
        content={content}
        dispatch={noop}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('+8blk');
    // Canonical status format (V5): self-buff keeps the `+` sign on the count but
    // now uses the unified `<ICON> +N` glyph (identity color + space), was `STR+1`.
    expect(frame).toContain('STR +1'); // enemy self-buff
  });
});

describe('CombatScreen juice beats (V6)', () => {
  it('shows no damage beat on the first combat render (no prior state)', () => {
    const { lastFrame } = render(
      <CombatScreen state={combatWith('skeleton-intern', 0)} content={content} dispatch={noop} />,
    );
    // First render has no prior to diff against → no `-N` beat anywhere.
    expect(lastFrame() ?? '').not.toMatch(/-\d+/);
  });

  it('shows a -N damage beat reflecting the HP lost on the last action', () => {
    const start = combatWith('skeleton-intern', 0);
    const full = (start.combat as CombatState).enemies[0]!.hp;
    const { lastFrame, rerender } = render(
      <CombatScreen state={start} content={content} dispatch={noop} />,
    );
    // The action lands: same combat object replaced with one where the enemy
    // took 7 damage → the diff surfaces a persistent `-7` beat.
    rerender(
      <CombatScreen state={withEnemyHp(start, full - 7)} content={content} dispatch={noop} />,
    );
    expect(lastFrame() ?? '').toContain('-7');
  });

  it('recomputes the beat on the next action (the old -N is gone)', () => {
    const start = combatWith('skeleton-intern', 0);
    const full = (start.combat as CombatState).enemies[0]!.hp;
    const { lastFrame, rerender } = render(
      <CombatScreen state={start} content={content} dispatch={noop} />,
    );
    rerender(<CombatScreen state={withEnemyHp(start, full - 7)} content={content} dispatch={noop} />);
    expect(lastFrame() ?? '').toContain('-7');
    // Next action deals 2 more (full-9): beat recomputes to the new delta only.
    rerender(<CombatScreen state={withEnemyHp(start, full - 9)} content={content} dispatch={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('-2');
    expect(frame).not.toContain('-7');
  });

  it('shows a DOWN beat on an enemy slain this action', () => {
    const start = combatWith('skeleton-intern', 0);
    const { lastFrame, rerender } = render(
      <CombatScreen state={start} content={content} dispatch={noop} />,
    );
    rerender(<CombatScreen state={withEnemyHp(start, 0)} content={content} dispatch={noop} />);
    expect(lastFrame() ?? '').toContain('DOWN');
  });
});
