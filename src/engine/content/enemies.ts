import type { EnemyDef } from '../types.js';

const defs: readonly EnemyDef[] = [
  {
    id: 'cave-rat',
    name: 'Cave Rat',
    sigil: '<:3',
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
    sigil: '[x_x]',
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
    sigil: '[vvv]',
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
    sigil: '>={',
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
  { id: 'spore-pod', name: 'Spore Pod', sigil: '(o)', hp: [9, 12], tier: 1, moves: [
    { name: 'Spew', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] },
    { name: 'Burst', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
  ] },
  { id: 'dust-mite', name: 'Dust Mite', sigil: ':*:', hp: [7, 10], tier: 1, moves: [
    { name: 'Nibble', effects: [{ kind: 'damage', amount: 3, target: 'enemy' }] },
    { name: 'Swarm', effects: [{ kind: 'damage', amount: 2, target: 'enemy', times: 2 }] },
  ] },
  { id: 'plague-rat', name: 'Plague Rat', sigil: '~:3', hp: [16, 20], tier: 2, moves: [
    { name: 'Infect', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] },
    { name: 'Scurry', effects: [{ kind: 'block', amount: 5 }] },
  ] },
  { id: 'rust-elemental', name: 'Rust Elemental', sigil: '#=#', hp: [22, 28], tier: 2, moves: [
    { name: 'Corrode', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }] },
    { name: 'Harden', effects: [{ kind: 'block', amount: 6 }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  ] },
  { id: 'byte-wraith', name: 'Byte Wraith', sigil: '01~', hp: [14, 18], tier: 2, moves: [
    { name: 'Glitch', effects: [{ kind: 'damage', amount: 3, target: 'enemy', times: 2 }] },
    { name: 'Corrupt', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'cache-hound', name: 'Cache Hound', sigil: 'd^.^b', hp: [26, 32], tier: 2, moves: [
    { name: 'Maul', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }] },
    { name: 'Howl', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  ] },
  { id: 'kernel-panic', name: 'Kernel Panic', sigil: '!X!', hp: [34, 42], tier: 3, moves: [
    { name: 'Crash', effects: [{ kind: 'damage', amount: 13, target: 'enemy' }] },
    { name: 'Halt', effects: [{ kind: 'block', amount: 8 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' }] },
    { name: 'Cascade', effects: [{ kind: 'damage', amount: 5, target: 'enemy', times: 2 }] },
  ] },
  { id: 'deadlock', name: 'Deadlock', sigil: '[#]', hp: [30, 38], tier: 3, moves: [
    { name: 'Seize', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' }] },
    { name: 'Fortify', effects: [{ kind: 'block', amount: 10 }, { kind: 'applyStatus', status: 'dexterity', stacks: 2, target: 'self' }] },
    { name: 'Grind', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
  ] },
  { id: 'heisenbug', name: 'Heisenbug', sigil: '?o?', hp: [20, 26], tier: 3, moves: [
    { name: 'Phase', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' }] },
    { name: 'Uncertainty', effects: [{ kind: 'block', amount: 6 }] },
    { name: 'Collapse', effects: [{ kind: 'damage', amount: 11, target: 'enemy' }] },
  ] },
  {
    id: 'the-scope-creep',
    name: 'The Scope Creep',
    sigil: '<{O.O}>',
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
    // At/under 50% HP the Scope Creep panics and ships everything at once: it
    // drops the defensive "Requirements Shift" stall for a tighter all-offense
    // pool built around the telegraphed "Ship Everything" signature (which rallies
    // +1 strength as it lands), punctuated by a "Crunch Time" block-only breather
    // so the fight reads as a closing window with beats, not a bigger stat-stick.
    // Pure HP gate (no rng).
    phases: [
      {
        hpThreshold: 0.5,
        name: 'Ship It All',
        moves: [
          {
            name: 'Feature Freeze',
            effects: [{ kind: 'damage', amount: 12, target: 'enemy' }],
          },
          {
            // Signature move: rallies (strength) then unloads a telegraphed
            // flurry. Named so the player can block/heal the turn it lands. It is
            // the big swing of the enraged phase — distinct and readable.
            name: 'Ship Everything',
            effects: [
              { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' },
              { kind: 'damage', amount: 4, target: 'enemy', times: 3 },
            ],
          },
          {
            // A defensive breather turn for the player: the boss gains block
            // instead of attacking. Keeps the enraged phase from being an
            // unbroken damage wall while still feeling like a frantic push.
            name: 'Crunch Time',
            effects: [{ kind: 'block', amount: 10 }],
          },
        ],
      },
    ],
  },
  // --- M6 content quota ---
  { id: 'gelatinous-snack', name: 'Gelatinous Snack', sigil: '(~~)', hp: [14, 18], moves: [
    { name: 'Engulf', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
    { name: 'Reconstitute', effects: [{ kind: 'block', amount: 5 }, { kind: 'applyStatus', status: 'regen', stacks: 2, target: 'self' }] },
  ] },
  { id: 'cursed-stapler', name: 'Cursed Stapler', sigil: '=v=', hp: [12, 16], moves: [
    { name: 'Staple', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }] },
    { name: 'Double Click', effects: [{ kind: 'damage', amount: 2, target: 'enemy', times: 2 }] },
  ] },
  { id: 'doom-scroller', name: 'Doom Scroller', sigil: '[v_v]', hp: [16, 20], moves: [
    { name: 'Dread Feed', effects: [{ kind: 'damage', amount: 3, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
    { name: 'Hot Take', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }] },
    { name: 'Ratio', effects: [{ kind: 'block', amount: 4 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'spaghetti-golem', name: 'Spaghetti Golem', sigil: '@~@', hp: [24, 30], moves: [
    { name: 'Tangle', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
    { name: 'Knot Up', effects: [{ kind: 'block', amount: 6 }] },
    { name: 'Loose Thread', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' }] },
  ] },
  { id: 'off-by-one', name: 'Off-By-One', sigil: '+1?', hp: [11, 13], moves: [
    { name: 'Fence Post', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }] },
    { name: 'Boundary Check', effects: [{ kind: 'block', amount: 3 }, { kind: 'damage', amount: 2, target: 'enemy' }] },
  ] },
  // HP trimmed [34,40] -> [30,35]: a shorter fight means fewer total Force Pushes
  // land, which cuts the CUMULATIVE raw burst exposure that kills the block-light
  // Apothecary (each turn's hit lands raw, no block buffer) without weakening the
  // per-hit threat — it stays a real elite. This shortens exposure; it does NOT
  // raise the enemy's Rebase block (that would make it tankier = longer fight =
  // MORE Force Pushes, the opposite of the goal).
  { id: 'merge-conflict', name: 'Merge Conflict', sigil: '><=><', hp: [30, 35], isElite: true,
    moves: [
      { name: 'Both Changes', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
      // Base-pool Force Push trimmed 12 -> 10 (now uniform with phase-2). The flat
      // 12 burst hit block-light classes (Apothecary) raw — no block buffer —
      // making merge-conflict ~boss-level lethal for them while Knight's block
      // soaked most of it. 10 is still a real elite hit but drops the raw spike;
      // paired with the HP trim above (which shortens cumulative exposure) it
      // brings Apothecary's merge-conflict death share to ~40% of its boss deaths
      // (from ~76%) while Knight's share is essentially unchanged (~25%).
      { name: 'Force Push', effects: [{ kind: 'damage', amount: 10, target: 'enemy' }] },
      // Rebase is a pure block breather (no strength) — Force Push stays flat
      // to stop cross-act escalation. The compounding strength gain (Force Push
      // 12 -> 13 -> 14 ...) was the bulk of merge-conflict's over-lethality across
      // its two arc encounters, where it out-killed all but the boss in nightmare.
      { name: 'Rebase', effects: [{ kind: 'block', amount: 6 }] },
    ],
    // Showcase phase: once cornered (<=30% HP) it goes aggressive — but, like the
    // boss's enraged phase, it punctuates the offense with a defensive block beat
    // ("Resolve Conflict") instead of force-pushing every single turn. This keeps
    // the closing window readable and stops phase 2 from being an unbroken ~12
    // dmg/turn wall that out-killed the boss in arc/nightmare. The later (0.3 vs
    // 0.4) trigger also shortens the time spent in the aggressive pool.
    phases: [
      {
        hpThreshold: 0.3,
        name: 'Unresolvable',
        moves: [
          // Phase-2 Force Push stays 10 (uniform with the base pool). The cornered
          // spam was the lethal spike that out-killed the boss; on a block-light
          // class (Apothecary) this raw spike is the dominant kill. The HP trim
          // (above) shortens the time spent here, cutting cumulative exposure.
          { name: 'Force Push', effects: [{ kind: 'damage', amount: 10, target: 'enemy' }] },
          { name: 'Both Changes', effects: [{ kind: 'damage', amount: 6, target: 'enemy', times: 2 }] },
          // Pure block breather (no strength) — a defensive beat that gives the
          // player a window, without ramping the follow-up Force Pushes.
          { name: 'Resolve Conflict', effects: [{ kind: 'block', amount: 6 }] },
        ],
      },
    ],
  },
];

export const enemies: Readonly<Record<string, EnemyDef>> = Object.fromEntries(
  defs.map((e) => [e.id, e]),
);
