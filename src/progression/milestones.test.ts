import { describe, expect, it } from 'vitest';
import {
  deriveUnlocks,
  ALL_UNLOCKABLE_IDS,
  MILESTONES,
  MILESTONE_RULES,
} from './milestones.js';
import type { MetaState, RunRecord } from '../persistence/saves.js';
import { UNLOCKABLE_CARD_IDS } from '../engine/content/cards.js';
import { UNLOCKABLE_RELIC_IDS } from '../engine/content/relics.js';
import { content } from '../engine/content/index.js';

const meta = (runs: readonly RunRecord[]): MetaState => ({ version: 2, runs });
const rec = (r: Partial<RunRecord> = {}): RunRecord => ({
  seed: 's',
  outcome: 'victory',
  endedAt: '2026-06-24T00:00:00Z',
  ...r,
});

describe('deriveUnlocks', () => {
  it('no runs → no unlocks', () => {
    expect(deriveUnlocks(meta([])).size).toBe(0);
  });

  it('defeats and abandons never unlock anything', () => {
    expect(
      deriveUnlocks(meta([rec({ outcome: 'defeat' }), rec({ outcome: 'abandoned' })])).size,
    ).toBe(0);
  });

  it('a first victory unlocks exactly the first-victory grants', () => {
    const unlocked = deriveUnlocks(meta([rec()]));
    expect([...unlocked].sort()).toEqual(['crawlers-resolve', 'heroic-second-wind']);
  });

  it('a hard victory unlocks the hard-victory relic+card on top of first-victory', () => {
    const unlocked = deriveUnlocks(meta([rec({ difficulty: 'hard' })]));
    expect(unlocked.has('hard-won-medallion')).toBe(true);
    expect(unlocked.has('hard-won-strike')).toBe(true);
    // first-victory also fires (a hard win is still a win)
    expect(unlocked.has('heroic-second-wind')).toBe(true);
  });

  it('nightmare counts as hard+', () => {
    expect(deriveUnlocks(meta([rec({ difficulty: 'nightmare' })])).has('hard-won-medallion')).toBe(
      true,
    );
  });

  it('a normal victory does NOT trigger the hard milestone', () => {
    expect(deriveUnlocks(meta([rec({ difficulty: 'normal' })])).has('hard-won-medallion')).toBe(
      false,
    );
  });

  it('an arc victory unlocks the arc grant', () => {
    expect(deriveUnlocks(meta([rec({ mode: 'arc' })])).has('arc-warden')).toBe(true);
    // single-mode victory does not
    expect(deriveUnlocks(meta([rec({ mode: 'single' })])).has('arc-warden')).toBe(false);
  });

  it('three victories unlock the veteran grants', () => {
    const two = deriveUnlocks(meta([rec(), rec()]));
    expect(two.has('veterans-edge')).toBe(false);
    const three = deriveUnlocks(meta([rec(), rec(), rec()]));
    expect(three.has('veterans-edge')).toBe(true);
    expect(three.has('trophy-rack')).toBe(true);
    expect(three.has('veterans-banner')).toBe(true);
  });

  it('is graceful on old records missing difficulty/mode (treated as not-matching)', () => {
    // A pre-E2 victory record (no difficulty/mode) still earns first-victory but
    // never the gated hard/arc milestones.
    const unlocked = deriveUnlocks(meta([rec({ difficulty: undefined, mode: undefined })]));
    expect(unlocked.has('heroic-second-wind')).toBe(true);
    expect(unlocked.has('hard-won-medallion')).toBe(false);
    expect(unlocked.has('arc-warden')).toBe(false);
  });
});

describe('unlockable content wiring', () => {
  it('every milestone grant id exists in content and is marked unlockable', () => {
    for (const id of ALL_UNLOCKABLE_IDS) {
      const isCard = UNLOCKABLE_CARD_IDS.has(id);
      const isRelic = UNLOCKABLE_RELIC_IDS.has(id);
      expect(isCard || isRelic, `${id} must be a marked unlockable card or relic`).toBe(true);
      if (isCard) expect(content.cards[id], id).toBeDefined();
      if (isRelic) expect(content.relics[id], id).toBeDefined();
    }
  });

  it('every marked-unlockable id is granted by some milestone (no orphans)', () => {
    for (const id of [...UNLOCKABLE_CARD_IDS, ...UNLOCKABLE_RELIC_IDS]) {
      expect(ALL_UNLOCKABLE_IDS.has(id), `${id} is unlockable but no milestone grants it`).toBe(
        true,
      );
    }
  });

  it('milestone ids on content match the MILESTONES table', () => {
    const known = new Set<string>(Object.values(MILESTONES));
    for (const def of Object.values(content.cards)) {
      if (def.unlock) expect(known.has(def.unlock), `${def.id}:${def.unlock}`).toBe(true);
    }
    for (const def of Object.values(content.relics)) {
      if (def.unlock) expect(known.has(def.unlock), `${def.id}:${def.unlock}`).toBe(true);
    }
  });

  it('there are at least 5 unlockable cards and 3 unlockable relics', () => {
    expect(UNLOCKABLE_CARD_IDS.size).toBeGreaterThanOrEqual(5);
    expect(UNLOCKABLE_RELIC_IDS.size).toBeGreaterThanOrEqual(3);
  });

  it('every rule grants at least one id', () => {
    for (const r of MILESTONE_RULES) expect(r.grants.length).toBeGreaterThan(0);
  });
});
