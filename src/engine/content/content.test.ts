import { describe, expect, it } from 'vitest';
import { CHARACTERS, DEFAULT_RUN_CONFIG, STARTER_DECK, content } from './index.js';
import { UPGRADE_TARGET_IDS } from './cards.js';
import type { Effect, EventOutcome, SimpleEventOutcome } from '../types.js';

const COMPOSITE_KINDS = new Set(['rollOutcomes', 'conditional']);

// #62: 'loseHp' (overheat self-cost) is a valid player-effect kind.
const EFFECT_KINDS = [
  'damage',
  'block',
  'draw',
  'gainEnergy',
  'heal',
  'applyStatus',
  'conditional',
  'loseHp',
];
const EFFECT_TARGETS = ['enemy', 'allEnemies', 'self'];
const EFFECT_STATUSES = ['strength', 'vulnerable', 'weak', 'regen', 'poison', 'dexterity', 'overcharge'];
const CONDITION_TYPES = ['targetHasStatus', 'enemyCount'];

/**
 * Recursively validate a single card/effect: kind + target/status are in their
 * closed sets, and a `conditional` (#42) is well-formed — its branches recurse
 * through the SAME validator so nested effects (any depth) are checked too.
 */
function checkEffect(effect: Effect, where: string): void {
  expect(EFFECT_KINDS, `${where}:${effect.kind}`).toContain(effect.kind);
  if ('target' in effect) expect(EFFECT_TARGETS, `${where}:target`).toContain(effect.target);
  // #62: where the optional overheat-gradient divisor is present (damage/block),
  // it must be a positive integer.
  if ((effect.kind === 'damage' || effect.kind === 'block') && effect.scaleMissingHp !== undefined) {
    expect(Number.isInteger(effect.scaleMissingHp), `${where}:scaleMissingHp int`).toBe(true);
    expect(effect.scaleMissingHp, `${where}:scaleMissingHp positive`).toBeGreaterThan(0);
    // #63 GUARDRAIL (carried nit from #62): the missing-HP gradient must NEVER be
    // combined with `times > 1` on a damage effect — the per-hit bonus would
    // multiply across hits, a degenerate scaling spike. Enforced for ALL content.
    if (effect.kind === 'damage') {
      expect(effect.times ?? 1, `${where}: times>1 with scaleMissingHp is degenerate`).toBe(1);
    }
  }
  if (effect.kind === 'applyStatus') {
    expect(EFFECT_STATUSES, `${where}:${effect.status}`).toContain(effect.status);
  }
  if (effect.kind === 'conditional') {
    expect(CONDITION_TYPES, `${where}:${effect.condition.type}`).toContain(effect.condition.type);
    if (effect.condition.type === 'targetHasStatus') {
      expect(EFFECT_STATUSES, `${where}:cond`).toContain(effect.condition.status);
    }
    // then must be non-empty (a branch that does nothing is a content bug);
    // else may be omitted. Recurse into BOTH so nested kinds are validated.
    expect(effect.then.length, `${where}: empty conditional then`).toBeGreaterThan(0);
    for (const inner of [...effect.then, ...(effect.else ?? [])]) {
      checkEffect(inner, `${where}>cond`);
    }
  }
}

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

  it('#69: hiddenOnMap is boolean and a curated ~1/3 of events are mystery', () => {
    const all = Object.values(content.events);
    for (const event of all) {
      if (event.hiddenOnMap !== undefined) {
        expect(typeof event.hiddenOnMap, `${event.id} hiddenOnMap`).toBe('boolean');
      }
    }
    const hidden = all.filter((e) => e.hiddenOnMap);
    // A deliberate fraction stays a mystery — neither all nor none.
    expect(hidden.length, 'some events are mystery').toBeGreaterThan(0);
    expect(hidden.length, 'most events are revealed').toBeLessThan(all.length);
    const frac = hidden.length / all.length;
    expect(frac, 'mystery fraction ~1/3-ish').toBeGreaterThanOrEqual(0.2);
    expect(frac, 'mystery fraction not a majority').toBeLessThanOrEqual(0.5);
  });

  it('#69: mystery (hiddenOnMap) correlates with spice — they are the rollOutcomes gambles', () => {
    for (const event of Object.values(content.events)) {
      const hasRoll = event.options.some((o) =>
        o.outcomes.some((out) => out.kind === 'rollOutcomes'),
      );
      // The curation rule: every hiddenOnMap event is a high-variance gamble.
      if (event.hiddenOnMap) {
        expect(hasRoll, `${event.id} is hidden but has no rollOutcomes gamble`).toBe(true);
      }
    }
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
    // #63: the Overclocker class ships with its overheat-fueled kit.
    expect(ids).toContain('overclocker');
    for (const c of Object.values(CHARACTERS)) {
      expect(c.starterDeck.length).toBeGreaterThan(0);
      for (const id of c.starterDeck) expect(content.cards[id], `${c.id}:${id}`).toBeDefined();
      for (const id of c.startingRelics) expect(content.relics[id], `${c.id}:${id}`).toBeDefined();
      expect(c.maxHp).toBeGreaterThan(0);
    }
  });

  it('#65: every overheat (loseHp) card reassures it "won\'t kill" the player', () => {
    // loseHp floors at 1 HP in the engine (it can never be lethal); the
    // description must SAY so or players sandbag at low HP.
    const overheat = Object.values(content.cards).filter((c) =>
      c.effects.some((e) => e.kind === 'loseHp'),
    );
    expect(overheat.length).toBeGreaterThan(0);
    for (const card of overheat) {
      expect(card.description.toLowerCase(), card.id).toContain("won't kill");
    }
  });

  it('#68: overdrive-core is an overcharge power (not the old loseHp+strength body)', () => {
    const card = content.cards['overdrive-core'];
    expect(card).toBeDefined();
    expect(card?.type).toBe('power');
    expect(card?.rarity).toBe('rare');
    // It grants overcharge and NOTHING else — no direct loseHp / strength.
    expect(card?.effects).toEqual([
      { kind: 'applyStatus', status: 'overcharge', stacks: 1, target: 'self' },
    ]);
  });

  it('#65: the Overclocker tagline conveys BOTH overheat AND the missing-HP gradient', () => {
    const desc = CHARACTERS.overclocker!.description.toLowerCase();
    expect(desc).toContain('burns hp'); // the overheat lever
    expect(desc).toContain('more hurt'); // the missing-HP gradient lever
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
      // #42: validate every effect kind/target/status, RECURSING into nested
      // conditional branches so a malformed nested effect can't slip through.
      for (const fx of card.effects) checkEffect(fx, card.id);
    }
    for (const enemy of Object.values(content.enemies)) {
      expect(enemy.hp[0], enemy.id).toBeLessThanOrEqual(enemy.hp[1]);
      expect(enemy.hp[0], enemy.id).toBeGreaterThan(0);
      expect(enemy.moves.length, enemy.id).toBeGreaterThan(0);
    }
  });

  it('conditional cards (#42) are well-formed and used by the intended cards', () => {
    // lucky-dagger gates bonus damage on the target being poisoned.
    const dagger = content.cards['lucky-dagger'];
    expect(dagger).toBeDefined();
    const cond = dagger!.effects.find((e) => e.kind === 'conditional');
    expect(cond, 'lucky-dagger has a conditional').toBeDefined();
    if (cond?.kind === 'conditional') {
      expect(cond.condition.type).toBe('targetHasStatus');
      if (cond.condition.type === 'targetHasStatus') expect(cond.condition.status).toBe('poison');
      // The bonus branch is a damage effect (recursive validation also covers this).
      expect(cond.then.some((e) => e.kind === 'damage')).toBe(true);
    }
    // #45: venom-reprisal is a poison PAYOFF — its conditional gates BONUS damage
    // AND extra poison on the target already being poisoned (rewards, never
    // consumes — no detonate loop), and it carries an upgrade.
    const reprisal = content.cards['venom-reprisal'];
    expect(reprisal, 'venom-reprisal exists').toBeDefined();
    expect(reprisal!.upgradeTo).toBe('venom-reprisal-plus');
    const rCond = reprisal!.effects.find((e) => e.kind === 'conditional');
    expect(rCond, 'venom-reprisal has a conditional').toBeDefined();
    if (rCond?.kind === 'conditional' && rCond.condition.type === 'targetHasStatus') {
      expect(rCond.condition.status).toBe('poison');
      // The payoff branch both deals damage and applies MORE poison (the ramp
      // accelerator) — but applies poison, never removes it.
      expect(rCond.then.some((e) => e.kind === 'damage')).toBe(true);
      expect(
        rCond.then.some((e) => e.kind === 'applyStatus' && e.status === 'poison' && e.stacks > 0),
        'payoff adds poison, never consumes it',
      ).toBe(true);
    }
    // #54: poison-finisher (Detonation Vial) is a LATE FINISHER — its conditional
    // gates a BIG fixed bonus on a HIGH poison threshold (>= 5, distinct from #45's
    // atLeast-1 ramp card), and it adds NO poison (pure burst, never consumes ->
    // no loop). It carries an upgrade.
    const finisher = content.cards['poison-finisher'];
    expect(finisher, 'poison-finisher exists').toBeDefined();
    expect(finisher!.upgradeTo).toBe('poison-finisher-plus');
    const fCond = finisher!.effects.find((e) => e.kind === 'conditional');
    expect(fCond, 'poison-finisher has a conditional').toBeDefined();
    if (fCond?.kind === 'conditional' && fCond.condition.type === 'targetHasStatus') {
      expect(fCond.condition.status).toBe('poison');
      // HIGH threshold is the whole identity (a late finisher, not an early-ramp
      // card) — guards against accidentally turning it into another Venom Reprisal.
      expect(fCond.condition.atLeast ?? 1).toBeGreaterThanOrEqual(5);
      // The payoff is a big fixed bonus DAMAGE and it must add NO poison (no ramp,
      // no consume) — a pure threshold->fixed-bonus finisher with no loop.
      expect(fCond.then.some((e) => e.kind === 'damage')).toBe(true);
      expect(
        fCond.then.every((e) => e.kind !== 'applyStatus'),
        'finisher adds no poison (pure burst, no loop)',
      ).toBe(true);
    }
    // whirlwind gates a single-target floor on exactly one living enemy.
    const ww = content.cards['whirlwind'];
    const wwCond = ww!.effects.find((e) => e.kind === 'conditional');
    expect(wwCond, 'whirlwind has a conditional').toBeDefined();
    if (wwCond?.kind === 'conditional' && wwCond.condition.type === 'enemyCount') {
      expect(wwCond.condition.op).toBe('eq');
      expect(wwCond.condition.value).toBe(1);
    }
  });

  it('#64: chain-reaction is a draftable GRADIENT AoE (no times+scale degenerate)', () => {
    const card = content.cards['chain-reaction'];
    expect(card, 'chain-reaction exists').toBeDefined();
    // Draftable: a real rarity and NOT an upgrade target.
    expect(card!.rarity).toBe('rare');
    expect(UPGRADE_TARGET_IDS.has('chain-reaction')).toBe(false);
    const dmg = card!.effects.find((e) => e.kind === 'damage');
    expect(dmg, 'has a damage effect').toBeDefined();
    if (dmg?.kind === 'damage') {
      // It is the class's multi-enemy answer: hits ALL enemies (never a single-
      // target nuke) and it is a gradient (scales with missing HP).
      expect(dmg.target).toBe('allEnemies');
      expect(dmg.scaleMissingHp).toBeGreaterThan(0);
      // The #62/#63 guardrail must hold for the new card too.
      expect(dmg.times ?? 1).toBe(1);
    }
  });

  it('#64: the overheat events resolve and keep an ungated (anti-stall) option', () => {
    for (const id of ['overclock-altar', 'coolant-reservoir']) {
      const ev = content.events[id];
      expect(ev, `${id} exists`).toBeDefined();
      // Every grant/cost id resolves (also covered generically, asserted here too).
      for (const option of ev!.options) {
        for (const outcome of option.outcomes) checkOutcome(outcome, id);
      }
      // Anti-stall: at least one option is always selectable.
      expect(ev!.options.some((o) => !o.requires), `${id} ungated option`).toBe(true);
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
    const TRIGGERS = ['combatStart', 'turnStart', 'onCardPlayed', 'onKill', 'onCombatEnd'];
    for (const relic of Object.values(content.relics)) {
      expect(TRIGGERS, `${relic.id}:${relic.trigger}`).toContain(relic.trigger);
      // onCombatEnd fires post-combat (no combat context) → heal-only effects.
      if (relic.trigger === 'onCombatEnd') {
        for (const fx of relic.effects) {
          expect(fx.kind, `${relic.id}:${fx.kind}`).toBe('heal');
        }
      }
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
