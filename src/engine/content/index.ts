import type { ContentRegistry } from '../types.js';
import type { RunConfig } from '../run.js';
import { cards } from './cards.js';
import { enemies } from './enemies.js';
import { relics } from './relics.js';
import { events } from './events.js';
import { potions } from './potions.js';
import { CHARACTERS, DEFAULT_CHARACTER } from './characters.js';

export const content: ContentRegistry = Object.freeze({
  cards,
  enemies,
  relics,
  events,
  potions,
});

export { CHARACTERS, DEFAULT_CHARACTER, CHARACTER_IDS } from './characters.js';
export type { Character } from './characters.js';

const defaultClass = CHARACTERS[DEFAULT_CHARACTER]!;

/** The default class's opening deck (kept for back-compat references). */
export const STARTER_DECK: readonly string[] = defaultClass.starterDeck;

/** Neutral baseline = the default class (Knight) at neutral difficulty/single mode. */
export const DEFAULT_RUN_CONFIG: RunConfig = Object.freeze({
  starterDeck: defaultClass.starterDeck,
  maxHp: defaultClass.maxHp,
  startingGold: 50,
  startingRelics: defaultClass.startingRelics,
});
