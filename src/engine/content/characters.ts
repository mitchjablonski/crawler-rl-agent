export interface Character {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly starterDeck: readonly string[];
  readonly startingRelics: readonly string[];
  readonly maxHp: number;
}

// D20: reworked from 5x shortsword + 4x buckler (9 cards, heavily redundant —
// the extra shortswords were dead draws and the Knight had no kit identity).
// Now 4x shortsword + 3x buckler + the two guardian-identity starters: a
// block+draw tempo card (Oath-Keeper) that cuts dead draws, and a
// block+self-strength card (Vanguard Stance) that gives the Knight a real
// scaling lean. Still 9 cards, 1 cost each, coherent block/strength guardian.
const KNIGHT_DECK: readonly string[] = [
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'battered-buckler',
  'battered-buckler',
  'battered-buckler',
  'oath-keeper',
  'vanguard-stance',
];

// #26: arc-relevant rework. The old deck (4x shortsword / 3x buckler / 2x
// tipped-blade) was strong in SINGLE but trailed Knight badly in ARC's
// multi-enemy rooms — tipped-blade's poison must be re-applied per enemy, so it
// scaled poorly against a pack. Trim one redundant shortsword and one of the two
// single-target tipped-blades, and add 2x the Spore-Burst kit starter: a cost-1
// AoE attack (5 dmg + 1 poison to ALL enemies) that hits the whole room in one
// card. Its value scales with pack size — in ARC two spore-bursts clear packs
// fast and seed the poison clock across the room, while in SINGLE (one boss)
// each is just 5 dmg + 1 poison (roughly a shortsword), so it lifts ARC far more
// than SINGLE and the already-even single matchup does NOT overshoot the Knight.
// One tipped-blade is kept for single-target poison. Still 9 cards, poison-
// leaning, 1 cost each. maxHp unchanged (64).
const APOTHECARY_DECK: readonly string[] = [
  'rusty-shortsword',
  'rusty-shortsword',
  'rusty-shortsword',
  'battered-buckler',
  'battered-buckler',
  'battered-buckler',
  'tipped-blade',
  'spore-burst',
  'spore-burst',
];

export const CHARACTERS: Readonly<Record<string, Character>> = {
  knight: {
    id: 'knight',
    name: 'Knight',
    description: 'A stalwart guardian. Stacks Block and Strength, then strikes.',
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
