import { describe, expect, it } from 'vitest';
import { CHARACTERS, DEFAULT_RUN_CONFIG, STARTER_DECK, content } from './index.js';
import { UPGRADE_TARGET_IDS } from './cards.js';
import type { EventOutcome, SimpleEventOutcome } from '../types.js';

const COMPOSITE_KINDS = new Set(['rollOutcomes', 'conditional']);

/** Assert a simple outcome's gainCard/gainRelic id resolves. */
function checkSimple(outcome: SimpleEventOutcome, where: string): void {
  if (outcome.kind === 'gainCard') {
    expect(content.cards[outcome.cardId], `${where}: ${outcome.cardId}`).toBeDefined();
  }
  if (outcome.kind === 'gainRelic') {
    expect(content.relics[outcome.relicId], `${where}: ${outcome.relicId}`).toBeDefined();
  }
}

/** Recurse one level into an outcome, validating ids and the depth invariant. */
function checkOutcome(outcome: EventOutcome, where: string): void {
  if (outcome.kind === 'rollOutcomes') {
    for (const branch of outcome.branches) {
      for (const inner of branch) {
        // Branches must contain only simple kinds (≤1 level deep).
        expect(COMPOSITE_KINDS.has(inner.kind), `${where}: nested composite in roll`).toBe(false);
        checkSimple(inner, where);
      }
    }
    return;
  }
  if (outcome.kind === 'conditional') {
    for (const inner of [...outcome.ifPass, ...outcome.ifFail]) {
      expect(COMPOSITE_KINDS.has(inner.kind), `${where}: nested composite in conditional`).toBe(
        false,
      );
      checkSimple(inner, where);
    }
    return;
  }
  checkSimple(outcome, where);
}

/**
 * Re-derive the draftable pool the way run.ts's rollCardChoices builds it:
 * non-starter cards that are NOT some card's upgradeTo target.
 */
function draftablePool(): string[] {
  return Object.values(content.cards)
    .filter((c) => c.rarity !== 'starter' && !UPGRADE_TARGET_IDS.has(c.id))
    .map((c) => c.id);
}

describe('content quota (REQ-1)', () => {
  it('meets the authored quota', () => {
    expect(Object.keys(content.cards).length).toBeGreaterThanOrEqual(50);
    const enemies = Object.values(content.enemies);
    expect(enemies.length).toBeGreaterThanOrEqual(18);
    expect(enemies.filter((e) => e.isElite).length).toBeGreaterThanOrEqual(2);
    expect(enemies.filter((e) => e.isBoss).length).toBeGreaterThanOrEqual(1);
    // tiered normal enemies exist for act escalation
    expect(enemies.filter((e) => (e.tier ?? 1) >= 2).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(content.relics).length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(content.events).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(content.potions).length).toBeGreaterThanOrEqual(6);
  });
});

describe('content integrity', () => {
  it('has no dangling ids in events (recursing into rolls/conditionals)', () => {
    for (const event of Object.values(content.events)) {
      for (const option of event.options) {
        for (const outcome of option.outcomes) {
          checkOutcome(outcome, event.id);
        }
      }
    }
  });

  it('events use the risk/reward and stat-check mechanics', () => {
    let rollEvents = 0;
    let statEvents = 0;
    for (const event of Object.values(content.events)) {
      let hasRoll = false;
      let hasStat = false;
      for (const option of event.options) {
        if (option.requires) hasStat = true;
        for (const outcome of option.outcomes) {
          if (outcome.kind === 'rollOutcomes') hasRoll = true;
          if (outcome.kind === 'conditional') hasStat = true;
        }
      }
      if (hasRoll) rollEvents++;
      if (hasStat) statEvents++;
    }
    expect(rollEvents, 'risk/reward events').toBeGreaterThanOrEqual(3);
    expect(statEvents, 'stat-check events').toBeGreaterThanOrEqual(2);
  });

  it('every event has at least one always-available (ungated) option', () => {
    // Anti-stall safety: if all options were gated and the player met none,
    // legalActions would return [] in the option phase and the run would hang.
    for (const event of Object.values(content.events)) {
      expect(
        event.options.some((o) => !o.requires),
        `${event.id} has no ungated option`,
      ).toBe(true);
    }
  });

  it('every upgradeTo references a real card (and the base/target differ)', () => {
    for (const card of Object.values(content.cards)) {
      if (card.upgradeTo === undefined) continue;
      expect(content.cards[card.upgradeTo], `${card.id} -> ${card.upgradeTo}`).toBeDefined();
      expect(card.upgradeTo).not.toBe(card.id);
    }
  });

  it('upgraded variants are not themselves upgradeable (no chains/cycles)', () => {
    for (const targetId of UPGRADE_TARGET_IDS) {
      const target = content.cards[targetId];
      expect(target, targetId).toBeDefined();
      // An upgrade target must not carry its own upgradeTo (no chains), which
      // also rules out any A<->B cycle.
      expect(target?.upgradeTo, `${targetId} should be terminal`).toBeUndefined();
    }
  });

  it('a meaningful subset of cards is upgradeable', () => {
    // All starters + commons + a handful of uncommon/rare were authored.
    expect(UPGRADE_TARGET_IDS.size).toBeGreaterThanOrEqual(15);
  });

  it('no upgraded variant is draftable (excluded from the reward/shop pool)', () => {
    const pool = new Set(draftablePool());
    for (const targetId of UPGRADE_TARGET_IDS) {
      expect(pool.has(targetId), `${targetId} must not be draftable`).toBe(false);
    }
    // Sanity: the pool is still non-empty after exclusion.
    expect(pool.size).toBeGreaterThan(0);
  });

  it('every character kit resolves to real cards and relics', () => {
    const ids = Object.keys(CHARACTERS);
    expect(ids).toContain('knight');
    expect(ids).toContain('apothecary');
    for (const c of Object.values(CHARACTERS)) {
      expect(c.starterDeck.length).toBeGreaterThan(0);
      for (const id of c.starterDeck) expect(content.cards[id], `${c.id}:${id}`).toBeDefined();
      for (const id of c.startingRelics) expect(content.relics[id], `${c.id}:${id}`).toBeDefined();
      expect(c.maxHp).toBeGreaterThan(0);
    }
  });

  it('starter deck and starting relics resolve', () => {
    for (const id of STARTER_DECK) expect(content.cards[id], id).toBeDefined();
    for (const id of DEFAULT_RUN_CONFIG.startingRelics) {
      expect(content.relics[id], id).toBeDefined();
    }
  });

  it('cards and enemies stay within sane bounds', () => {
    for (const card of Object.values(content.cards)) {
      expect(card.cost, card.id).toBeGreaterThanOrEqual(0);
      expect(card.cost, card.id).toBeLessThanOrEqual(3);
      expect(card.effects.length, card.id).toBeGreaterThan(0);
      expect(card.id).toMatch(/^[a-z0-9-]+$/);
    }
    for (const enemy of Object.values(content.enemies)) {
      expect(enemy.hp[0], enemy.id).toBeLessThanOrEqual(enemy.hp[1]);
      expect(enemy.hp[0], enemy.id).toBeGreaterThan(0);
      expect(enemy.moves.length, enemy.id).toBeGreaterThan(0);
    }
  });

  it('enemy phases are well-formed (thresholds in (0,1], ascending, valid effects)', () => {
    const KINDS = ['damage', 'block', 'draw', 'gainEnergy', 'heal', 'applyStatus'];
    const TARGETS = ['enemy', 'allEnemies', 'self'];
    const STATUSES = ['strength', 'vulnerable', 'weak', 'regen', 'poison', 'dexterity'];
    for (const enemy of Object.values(content.enemies)) {
      const phases = enemy.phases;
      if (!phases) continue;
      expect(phases.length, enemy.id).toBeGreaterThan(0);
      let prev = -Infinity;
      for (const phase of phases) {
        expect(phase.hpThreshold, `${enemy.id} threshold`).toBeGreaterThan(0);
        expect(phase.hpThreshold, `${enemy.id} threshold`).toBeLessThanOrEqual(1);
        // Ascending order is the selection contract (first phase with t >= ratio).
        expect(phase.hpThreshold, `${enemy.id} phases must ascend`).toBeGreaterThan(prev);
        prev = phase.hpThreshold;
        expect(phase.moves.length, `${enemy.id} phase pool`).toBeGreaterThan(0);
        for (const move of phase.moves) {
          expect(move.effects.length, `${enemy.id}:${move.name}`).toBeGreaterThan(0);
          for (const fx of move.effects) {
            expect(KINDS, `${enemy.id}:${move.name}:${fx.kind}`).toContain(fx.kind);
            if ('target' in fx) expect(TARGETS, `${enemy.id}:${move.name}`).toContain(fx.target);
            if (fx.kind === 'applyStatus') {
              expect(STATUSES, `${enemy.id}:${move.name}:${fx.status}`).toContain(fx.status);
            }
          }
        }
      }
    }
  });

  it('the boss has phases (dynamic fight, not a stat-stick)', () => {
    const boss = Object.values(content.enemies).find((e) => e.isBoss);
    expect(boss, 'a boss enemy exists').toBeDefined();
    expect(boss?.phases?.length, `${boss?.id} should have phases`).toBeGreaterThan(0);
    // The enraged pool surfaces a distinct signature move not in the base set.
    const baseNames = new Set(boss!.moves.map((m) => m.name));
    const phaseNames = boss!.phases!.flatMap((p) => p.moves.map((m) => m.name));
    expect(phaseNames.some((n) => !baseNames.has(n)), 'signature move is new').toBe(true);
    for (const relic of Object.values(content.relics)) {
      expect(relic.effects.length, relic.id).toBeGreaterThan(0);
    }
  });

  it('relics use a valid trigger and any condition is well-formed', () => {
    const TRIGGERS = ['combatStart', 'turnStart', 'onCardPlayed', 'onKill'];
    for (const relic of Object.values(content.relics)) {
      expect(TRIGGERS, `${relic.id}:${relic.trigger}`).toContain(relic.trigger);
      if (relic.condition) {
        expect(relic.condition.kind, relic.id).toBe('hpBelow');
        expect(relic.condition.pct, relic.id).toBeGreaterThan(0);
        expect(relic.condition.pct, relic.id).toBeLessThanOrEqual(100);
      }
    }
  });

  it('potions compose only valid effect kinds/targets', () => {
    const KINDS = ['damage', 'block', 'draw', 'gainEnergy', 'heal', 'applyStatus'];
    const TARGETS = ['enemy', 'allEnemies', 'self'];
    const STATUSES = ['strength', 'vulnerable', 'weak', 'regen', 'poison', 'dexterity'];
    for (const potion of Object.values(content.potions)) {
      expect(potion.id).toMatch(/^[a-z0-9-]+$/);
      expect(potion.effects.length, potion.id).toBeGreaterThan(0);
      expect(TARGETS, potion.id).toContain(potion.target);
      for (const fx of potion.effects) {
        expect(KINDS, `${potion.id}:${fx.kind}`).toContain(fx.kind);
        if ('target' in fx) expect(TARGETS, potion.id).toContain(fx.target);
        if (fx.kind === 'applyStatus') {
          expect(STATUSES, `${potion.id}:${fx.status}`).toContain(fx.status);
        }
      }
      // An enemy-target potion must actually carry an enemy-directed effect.
      if (potion.target !== 'self') {
        expect(
          potion.effects.some((fx) => 'target' in fx && fx.target !== 'self'),
          potion.id,
        ).toBe(true);
      }
    }
  });
});
