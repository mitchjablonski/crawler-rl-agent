import type { EnemyDef } from '../types.js';

const defs: readonly EnemyDef[] = [
  {
    id: 'cave-rat',
    name: 'Cave Rat',
    hp: [10, 14],
    moves: [
      { name: 'Bite', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }] },
      {
        name: 'Gnaw',
        effects: [
          { kind: 'damage', amount: 3, target: 'enemy' },
          { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' },
        ],
      },
    ],
  },
  {
    id: 'skeleton-intern',
    name: 'Skeleton Intern',
    hp: [18, 22],
    moves: [
      { name: 'Stapler Jab', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }] },
      { name: 'Coffee Break', effects: [{ kind: 'block', amount: 6 }] },
      {
        name: 'Filing Frenzy',
        effects: [
          { kind: 'damage', amount: 4, target: 'enemy' },
          { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' },
        ],
      },
    ],
  },
  {
    id: 'mimic-crate',
    name: 'Mimic Crate',
    hp: [20, 26],
    moves: [
      { name: 'Chomp', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }] },
      {
        name: 'Lid Slam',
        effects: [
          { kind: 'damage', amount: 5, target: 'enemy' },
          { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' },
        ],
      },
    ],
  },
  {
    id: 'lint-goblin',
    name: 'Lint Goblin',
    hp: [30, 36],
    isElite: true,
    moves: [
      {
        name: 'Nitpick',
        effects: [{ kind: 'damage', amount: 4, target: 'enemy', times: 2 }],
      },
      {
        name: 'Style Violation',
        effects: [
          { kind: 'damage', amount: 9, target: 'enemy' },
          { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' },
        ],
      },
      {
        name: 'Refactor Rage',
        effects: [
          { kind: 'block', amount: 8 },
          { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' },
        ],
      },
    ],
  },
  // --- M12 expansion: tiered enemies (tier gates them to deeper acts) ---
  { id: 'spore-pod', name: 'Spore Pod', hp: [9, 12], tier: 1, moves: [
    { name: 'Spew', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] },
    { name: 'Burst', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
  ] },
  { id: 'dust-mite', name: 'Dust Mite', hp: [7, 10], tier: 1, moves: [
    { name: 'Nibble', effects: [{ kind: 'damage', amount: 3, target: 'enemy' }] },
    { name: 'Swarm', effects: [{ kind: 'damage', amount: 2, target: 'enemy', times: 2 }] },
  ] },
  { id: 'plague-rat', name: 'Plague Rat', hp: [16, 20], tier: 2, moves: [
    { name: 'Infect', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] },
    { name: 'Scurry', effects: [{ kind: 'block', amount: 5 }] },
  ] },
  { id: 'rust-elemental', name: 'Rust Elemental', hp: [22, 28], tier: 2, moves: [
    { name: 'Corrode', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }] },
    { name: 'Harden', effects: [{ kind: 'block', amount: 6 }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  ] },
  { id: 'byte-wraith', name: 'Byte Wraith', hp: [14, 18], tier: 2, moves: [
    { name: 'Glitch', effects: [{ kind: 'damage', amount: 3, target: 'enemy', times: 2 }] },
    { name: 'Corrupt', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'cache-hound', name: 'Cache Hound', hp: [26, 32], tier: 2, moves: [
    { name: 'Maul', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }] },
    { name: 'Howl', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  ] },
  { id: 'kernel-panic', name: 'Kernel Panic', hp: [34, 42], tier: 3, moves: [
    { name: 'Crash', effects: [{ kind: 'damage', amount: 13, target: 'enemy' }] },
    { name: 'Halt', effects: [{ kind: 'block', amount: 8 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' }] },
    { name: 'Cascade', effects: [{ kind: 'damage', amount: 5, target: 'enemy', times: 2 }] },
  ] },
  { id: 'deadlock', name: 'Deadlock', hp: [30, 38], tier: 3, moves: [
    { name: 'Seize', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' }] },
    { name: 'Fortify', effects: [{ kind: 'block', amount: 10 }, { kind: 'applyStatus', status: 'dexterity', stacks: 2, target: 'self' }] },
    { name: 'Grind', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
  ] },
  { id: 'heisenbug', name: 'Heisenbug', hp: [20, 26], tier: 3, moves: [
    { name: 'Phase', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' }] },
    { name: 'Uncertainty', effects: [{ kind: 'block', amount: 6 }] },
    { name: 'Collapse', effects: [{ kind: 'damage', amount: 11, target: 'enemy' }] },
  ] },
  {
    id: 'the-scope-creep',
    name: 'The Scope Creep',
    hp: [96, 112],
    isBoss: true,
    moves: [
      {
        name: 'Just One More Feature',
        effects: [{ kind: 'damage', amount: 11, target: 'enemy' }],
      },
      {
        name: 'Requirements Shift',
        effects: [
          { kind: 'block', amount: 12 },
          { kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' },
        ],
      },
      {
        name: 'Deadline Crunch',
        effects: [{ kind: 'damage', amount: 7, target: 'enemy', times: 2 }],
      },
    ],
  },
  // --- M6 content quota ---
  { id: 'gelatinous-snack', name: 'Gelatinous Snack', hp: [14, 18], moves: [
    { name: 'Engulf', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
    { name: 'Reconstitute', effects: [{ kind: 'block', amount: 5 }, { kind: 'applyStatus', status: 'regen', stacks: 2, target: 'self' }] },
  ] },
  { id: 'cursed-stapler', name: 'Cursed Stapler', hp: [12, 16], moves: [
    { name: 'Staple', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }] },
    { name: 'Double Click', effects: [{ kind: 'damage', amount: 2, target: 'enemy', times: 2 }] },
  ] },
  { id: 'doom-scroller', name: 'Doom Scroller', hp: [16, 20], moves: [
    { name: 'Dread Feed', effects: [{ kind: 'damage', amount: 3, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
    { name: 'Hot Take', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }] },
    { name: 'Ratio', effects: [{ kind: 'block', amount: 4 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'spaghetti-golem', name: 'Spaghetti Golem', hp: [24, 30], moves: [
    { name: 'Tangle', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
    { name: 'Knot Up', effects: [{ kind: 'block', amount: 6 }] },
    { name: 'Loose Thread', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'off-by-one', name: 'Off-By-One', hp: [11, 13], moves: [
    { name: 'Fence Post', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }] },
    { name: 'Boundary Check', effects: [{ kind: 'block', amount: 3 }, { kind: 'damage', amount: 2, target: 'enemy' }] },
  ] },
  { id: 'merge-conflict', name: 'Merge Conflict', hp: [34, 40], isElite: true, moves: [
    { name: 'Both Changes', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
    { name: 'Force Push', effects: [{ kind: 'damage', amount: 12, target: 'enemy' }] },
    { name: 'Rebase', effects: [{ kind: 'block', amount: 6 }, { kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  ] },
];

export const enemies: Readonly<Record<string, EnemyDef>> = Object.fromEntries(
  defs.map((e) => [e.id, e]),
);
