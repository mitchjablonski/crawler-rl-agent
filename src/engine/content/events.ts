import type { NarrativeEventDef } from '../types.js';

const defs: readonly NarrativeEventDef[] = [
  {
    id: 'abandoned-vending-machine',
    name: 'Abandoned Vending Machine',
    prompt:
      'A vending machine hums in the dark, decades from the nearest power outlet. Its glass is fogged with something that is probably condensation.',
    options: [
      {
        label: 'Kick it until something falls out',
        outcomes: [
          { kind: 'gainGold', amount: 30 },
          { kind: 'loseHp', amount: 4 },
        ],
      },
      {
        label: 'Reach inside the flap',
        outcomes: [
          { kind: 'gainCard', cardId: 'lucky-dagger' },
          { kind: 'loseHp', amount: 6 },
        ],
      },
      { label: 'Walk away', outcomes: [] },
    ],
  },
  {
    id: 'shrine-of-the-crawl',
    name: 'Shrine of the Crawl',
    prompt:
      'A squat stone shrine, worn smooth by ten thousand desperate hands. Coins glitter in the offering bowl. A sign reads: THE DUNGEON IS WATCHING.',
    options: [
      { label: 'Pray', outcomes: [{ kind: 'gainMaxHp', amount: 6 }] },
      {
        label: 'Pry up the offerings',
        outcomes: [
          { kind: 'gainGold', amount: 45 },
          { kind: 'loseHp', amount: 5 },
        ],
      },
    ],
  },
  // --- M6 content quota ---
  { id: 'goblin-toll-booth', name: 'Goblin Toll Booth', prompt: 'A goblin in a regulation-size booth blocks the corridor. The sign lists seventeen toll categories. All of them apply to you.', options: [
    { label: 'Pay the toll', outcomes: [{ kind: 'loseGold', amount: 30 }] },
    { label: 'Squeeze past the barrier', outcomes: [{ kind: 'loseHp', amount: 7 }] },
    { label: 'Argue about jurisdiction', outcomes: [{ kind: 'loseGold', amount: 10 }, { kind: 'loseHp', amount: 3 }] },
  ] },
  { id: 'abandoned-armory', name: 'Abandoned Armory', prompt: 'Racks of equipment under centuries of dust. A sign reads: TAKE ONE. The handwriting is ominous.', options: [
    { label: 'Take the shield', outcomes: [{ kind: 'gainCard', cardId: 'shield-wall' }] },
    { label: 'Take the whetstone', outcomes: [{ kind: 'gainRelic', relicId: 'whetstone' }] },
    { label: 'Take everything, quickly', outcomes: [{ kind: 'gainCard', cardId: 'shield-wall' }, { kind: 'gainRelic', relicId: 'whetstone' }, { kind: 'loseHp', amount: 16 }] },
  ] },
  { id: 'complaints-department', name: 'The Complaints Department', prompt: 'A window in the rock face, lit from within. The plaque says THE DUNGEON LISTENS. It does not.', options: [
    { label: 'File a formal complaint', outcomes: [{ kind: 'gainGold', amount: 15 }, { kind: 'loseHp', amount: 2 }] },
    { label: 'Read the complaint wall (inspiring, but a long read)', outcomes: [{ kind: 'gainMaxHp', amount: 6 }, { kind: 'loseHp', amount: 4 }] },
    { label: 'Leave quietly', outcomes: [] },
  ] },
  { id: 'suspicious-healer', name: 'Suspicious Healer', prompt: 'A robed figure with too many rings gestures at a bubbling cauldron. "Free sample," it says, in a tone that has clearly said it many times.', options: [
    { label: 'Accept the free sample', outcomes: [{ kind: 'loseHp', amount: 5 }, { kind: 'gainMaxHp', amount: 6 }] },
    { label: 'Pay for the real thing', outcomes: [{ kind: 'loseGold', amount: 35 }, { kind: 'gainMaxHp', amount: 8 }] },
    { label: 'Decline politely', outcomes: [] },
  ] },
  // --- M12 expansion ---
  { id: 'traveling-alchemist', name: 'Traveling Alchemist', prompt: 'A cart of bubbling vials, attended by someone with no eyebrows. "Potent stuff," they wheeze.', options: [
    { label: 'Take the green vial', outcomes: [{ kind: 'gainCard', cardId: 'viral-load' }, { kind: 'loseHp', amount: 4 }] },
    { label: 'Buy the antidote', outcomes: [{ kind: 'loseGold', amount: 25 }, { kind: 'gainMaxHp', amount: 5 }] },
    { label: 'Keep walking', outcomes: [] },
  ] },
  { id: 'cursed-idol', name: 'Cursed Idol', prompt: 'A leering idol clutches something that gleams. The air smells faintly of regret.', options: [
    { label: 'Pry it loose', outcomes: [{ kind: 'gainRelic', relicId: 'war-paint' }, { kind: 'loseHp', amount: 8 }] },
    { label: 'Leave it well alone', outcomes: [] },
  ] },
  { id: 'abandoned-cache', name: 'Abandoned Cache', prompt: 'A strongbox wedged in the rubble. The lock is rusted; the hinges are not.', options: [
    { label: 'Force it open', outcomes: [{ kind: 'gainGold', amount: 40 }, { kind: 'loseHp', amount: 5 }] },
    { label: 'Pick it carefully', outcomes: [{ kind: 'gainGold', amount: 20 }] },
  ] },
  { id: 'whispering-well', name: 'Whispering Well', prompt: 'A well exhales cold air and your own voice, slightly out of sync.', options: [
    { label: 'Toss in a coin', outcomes: [{ kind: 'loseGold', amount: 20 }, { kind: 'gainMaxHp', amount: 6 }] },
    { label: 'Drink deep', outcomes: [{ kind: 'loseHp', amount: 6 }, { kind: 'gainMaxHp', amount: 8 }] },
    { label: 'Walk on', outcomes: [] },
  ] },
];

export const events: Readonly<Record<string, NarrativeEventDef>> = Object.fromEntries(
  defs.map((e) => [e.id, e]),
);
