import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { CHARACTERS, DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import {
  classConfig,
  emptyUsage,
  evaluatePlayer,
  greedyPlayer,
  nerfCard,
  nerfPotion,
  nerfRelic,
  runEpisode,
  telemetryHook,
} from './balance.js';

const rng = (tag: string): (() => number) => {
  const r = new Rng(seedFromString(tag));
  return () => r.next();
};

describe('balance toolkit', () => {
  it('runEpisode returns sane metrics on a terminal run', () => {
    const m = runEpisode(content, 'bal-1', DEFAULT_RUN_CONFIG, greedyPlayer(rng('p1')));
    expect(typeof m.won).toBe('boolean');
    expect(m.steps).toBeGreaterThan(0);
    expect(m.damageTaken).toBeGreaterThanOrEqual(0);
    expect(m.deepestRow).toBeGreaterThan(0);
    expect(m.finalHp).toBeGreaterThanOrEqual(0);
  });

  it('evaluatePlayer reports a win rate in [0,1] over seeds', () => {
    const seeds = Array.from({ length: 6 }, (_, i) => `e${i}`);
    const agg = evaluatePlayer(content, DEFAULT_RUN_CONFIG, greedyPlayer(rng('p2')), seeds);
    expect(agg.runs).toBe(6);
    expect(agg.winRate).toBeGreaterThanOrEqual(0);
    expect(agg.winRate).toBeLessThanOrEqual(1);
  });

  it('telemetry records the cards a run played', () => {
    const u = emptyUsage();
    runEpisode(content, 'bal-2', DEFAULT_RUN_CONFIG, greedyPlayer(rng('p3')), telemetryHook(u));
    let totalPlays = 0;
    for (const n of u.played.values()) totalPlays += n;
    expect(totalPlays).toBeGreaterThan(0); // a full run plays at least one card
    for (const id of u.played.keys()) expect(content.cards[id]).toBeDefined();
  });

  it('classConfig swaps starter deck / maxHp / relics for the chosen class', () => {
    const apo = CHARACTERS['apothecary']!;
    const cfg = classConfig('apothecary', DEFAULT_RUN_CONFIG);
    expect(cfg.starterDeck).toEqual(apo.starterDeck);
    expect(cfg.maxHp).toBe(apo.maxHp);
    expect(cfg.startingRelics).toEqual(apo.startingRelics);
    expect(() => classConfig('nonesuch', DEFAULT_RUN_CONFIG)).toThrow(/unknown class/);
  });

  it('nerf helpers strip effects without mutating the original content', () => {
    const cardId = Object.keys(content.cards).find((id) => content.cards[id]!.rarity !== 'starter')!;
    const before = content.cards[cardId]!.effects.length;
    const nc = nerfCard(content, cardId);
    expect(nc.cards[cardId]!.effects.length).toBe(0);
    expect(content.cards[cardId]!.effects.length).toBe(before); // original untouched

    const relicId = Object.keys(content.relics)[0]!;
    expect(nerfRelic(content, relicId).relics[relicId]!.effects.length).toBe(0);
    const potionId = Object.keys(content.potions)[0]!;
    expect(nerfPotion(content, potionId).potions[potionId]!.effects.length).toBe(0);
  });
});
