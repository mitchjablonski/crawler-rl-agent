export interface Character {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly starterDeck: readonly string[];
  readonly startingRelics: readonly string[];
  readonly maxHp: number;
}

const KNIGHT_DECK: readonly string[] = [
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'battered-buckler',
  'battered-buckler',
  'battered-buckler',
  'battered-buckler',
];

const APOTHECARY_DECK: readonly string[] = [
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'battered-buckler',
  'battered-buckler',
  'battered-buckler',
  'tipped-blade',
  'tipped-blade',
];

export const CHARACTERS: Readonly<Record<string, Character>> = {
  knight: {
    id: 'knight',
    name: 'Knight',
    description: 'A sturdy all-rounder. Strike and Block, the honest way.',
    starterDeck: KNIGHT_DECK,
    startingRelics: ['pocket-dice'],
    maxHp: 70,
  },
  apothecary: {
    id: 'apothecary',
    name: 'Apothecary',
    description: 'Fragile but venomous — opens with Poison, but thin on armor.',
    starterDeck: APOTHECARY_DECK,
    startingRelics: ['pocket-dice'],
    maxHp: 64,
  },
};

export const DEFAULT_CHARACTER = 'knight';
export const CHARACTER_IDS: readonly string[] = ['knight', 'apothecary'];
