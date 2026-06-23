import { describe, expect, it } from 'vitest';
import { CHARACTERS, DEFAULT_RUN_CONFIG, STARTER_DECK, content } from './index.js';

describe('content quota (REQ-1)', () => {
  it('meets the authored quota', () => {
    expect(Object.keys(content.cards).length).toBeGreaterThanOrEqual(50);
    const enemies = Object.values(content.enemies);
    expect(enemies.length).toBeGreaterThanOrEqual(18);
    expect(enemies.filter((e) => e.isElite).length).toBeGreaterThanOrEqual(2);
    expect(enemies.filter((e) => e.isBoss).length).toBeGreaterThanOrEqual(1);
    // tiered normal enemies exist for act escalation
    expect(enemies.filter((e) => (e.tier ?? 1) >= 2).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(content.relics).length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(content.events).length).toBeGreaterThanOrEqual(10);
  });
});

describe('content integrity', () => {
  it('has no dangling ids in events', () => {
    for (const event of Object.values(content.events)) {
      for (const option of event.options) {
        for (const outcome of option.outcomes) {
          if (outcome.kind === 'gainCard') {
            expect(content.cards[outcome.cardId], `${event.id}: ${outcome.cardId}`).toBeDefined();
          }
          if (outcome.kind === 'gainRelic') {
            expect(content.relics[outcome.relicId], `${event.id}: ${outcome.relicId}`).toBeDefined();
          }
        }
      }
    }
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
    for (const relic of Object.values(content.relics)) {
      expect(relic.effects.length, relic.id).toBeGreaterThan(0);
    }
  });
});
