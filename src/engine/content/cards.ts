import type { CardDef } from '../types.js';

const defs: readonly CardDef[] = [
  {
    id: 'rusty-shortsword',
    name: 'Rusty Shortsword',
    description: 'Deal 6 damage.',
    type: 'attack',
    rarity: 'starter',
    cost: 1,
    target: 'enemy',
    effects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
    upgradeTo: 'rusty-shortsword-plus',
  },
  {
    id: 'battered-buckler',
    name: 'Battered Buckler',
    description: 'Gain 5 Block.',
    type: 'skill',
    rarity: 'starter',
    cost: 1,
    target: 'self',
    effects: [{ kind: 'block', amount: 5 }],
    upgradeTo: 'battered-buckler-plus',
  },
  // --- D20: Knight kit-identity starters (guardian lean). starter rarity =>
  // NOT draftable (excluded from reward/shop pools), so these stay exclusive to
  // the Knight's starting deck. Each has a `-plus` rest-site upgrade (below).
  // Oath-Keeper is a block+draw tempo card: it pays for itself by replacing the
  // dead Rusty-Shortsword draws the old 5-sword deck suffered. Vanguard Stance
  // is a block+self-strength card that gives the Knight a real scaling identity
  // (every later attack hits harder), the guardian fantasy the class lacked.
  {
    id: 'oath-keeper',
    name: 'Oath-Keeper',
    description: 'Gain 5 Block. Draw 1 card.',
    type: 'skill',
    rarity: 'starter',
    cost: 1,
    target: 'self',
    effects: [
      { kind: 'block', amount: 5 },
      { kind: 'draw', count: 1 },
    ],
    upgradeTo: 'oath-keeper-plus',
  },
  {
    id: 'vanguard-stance',
    name: 'Vanguard Stance',
    description: 'Gain 5 Block and 1 Strength.',
    type: 'skill',
    rarity: 'starter',
    cost: 1,
    target: 'self',
    effects: [
      { kind: 'block', amount: 5 },
      { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' },
    ],
    upgradeTo: 'vanguard-stance-plus',
  },
  // --- #26: Apothecary kit-identity starter (arc / multi-enemy lean). starter
  // rarity => NOT draftable (excluded from reward/shop pools), so it stays
  // exclusive to the Apothecary's starting deck. Has a `-plus` rest-site upgrade
  // (below). Spore Burst is a low-cost AoE attack (5 dmg + 1 poison to ALL
  // enemies) that hits the whole pack in one card and seeds the poison clock
  // across the room. In ARC's multi-enemy rooms its value scales with pack size
  // (it can soften or clear several enemies at once), closing the Apothecary's
  // arc gap the same way #20's kit cards closed the Knight's single gap. In
  // SINGLE (one boss) it reduces to ~5 dmg + 1 poison — roughly a shortsword,
  // strictly modest — so it lifts ARC far more than SINGLE and can't balloon the
  // already-even single matchup. Calibrated between cleave-the-horde (5 dmg all,
  // common) and whirlwind (6 dmg all, uncommon); justified as a non-draftable
  // kit exclusive that defines the arc-poison archetype.
  {
    id: 'spore-burst',
    name: 'Spore Burst',
    description: 'Deal 5 damage to all enemies. Apply 1 Poison to all enemies.',
    type: 'attack',
    rarity: 'starter',
    cost: 1,
    target: 'allEnemies',
    effects: [
      { kind: 'damage', amount: 5, target: 'allEnemies' },
      { kind: 'applyStatus', status: 'poison', stacks: 1, target: 'allEnemies' },
    ],
    upgradeTo: 'spore-burst-plus',
  },
  {
    id: 'goblin-stomp',
    // #61: STILL dead after two prior damage buffs (#55) — the cost-2 common slot
    // is structurally capped below 0-cost commons, so more damage can't rescue it.
    // Retire the "buff the damage" approach and change the SLOT instead: cost 2→1,
    // damage 11→7 (keep 2 Vulnerable). A cheap 1-cost vulnerable-setter is
    // distinctive and draftable — fewer raw damage than torch-jab (1-cost 8 dmg +
    // 1 vuln) but DOUBLE the vulnerable, so it's a tempo/setup card, not a worse
    // torch-jab.
    name: 'Goblin Stomp',
    description: 'Deal 7 damage. Apply 2 Vulnerable.',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    effects: [
      { kind: 'damage', amount: 7, target: 'enemy' },
      { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' },
    ],
    upgradeTo: 'goblin-stomp-plus',
  },
  {
    id: 'cleave-the-horde',
    // #55: dead AoE common — at 5 dmg all it was a worse spore-burst (starter,
    // 5 dmg + 1 poison all) with no poison rider and no upside. Differentiate via
    // a small AoE vulnerable RIDER (knight has no poison archetype): 6 dmg + 1
    // Vulnerable to all enemies at cost 1. Still under whirlwind (2-cost AoE with
    // a single-target floor) and under torch-jab's single-target tempo, so it
    // lifts the pack-clear common without overshoot.
    name: 'Cleave the Horde',
    description: 'Deal 6 damage to all enemies. Apply 1 Vulnerable to all enemies.',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'allEnemies',
    effects: [
      { kind: 'damage', amount: 6, target: 'allEnemies' },
      { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'allEnemies' },
    ],
    upgradeTo: 'cleave-the-horde-plus',
  },
  {
    id: 'weakening-jab',
    // #67 deadcard-pass7: greedy read this ~0.00 for many passes, but MCTS (the
    // arbiter) drafts it heavily (knight 0.56 / apoth 0.29 / over 0.17) — `weak`
    // is a defensive-tempo blind spot the greedy ranking under-rates against pure
    // damage. BUFF to greedy-visibility (lift the static score into the contested
    // torch-jab band, ~0.27) by leaning the debuff identity: 5 dmg + 2 weak ->
    // 6 dmg + 3 weak. Still no auto-pick (well under the 0.7+ staples).
    name: 'Weakening Jab',
    description: 'Deal 6 damage. Apply 3 Weak.',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    effects: [
      { kind: 'damage', amount: 6, target: 'enemy' },
      { kind: 'applyStatus', status: 'weak', stacks: 3, target: 'enemy' },
    ],
    upgradeTo: 'weakening-jab-plus',
  },
  {
    id: 'second-breakfast',
    // #55: dead heal-cantrip — 3 HP + draw 1 was too little sustain to draft over
    // a pure draw/tempo skill. Bump heal 3→5 (still a modest cost-1 sustain
    // cantrip, under second-wind's 6 raw heal which has no draw).
    name: 'Second Breakfast',
    description: 'Heal 5 HP. Draw 1 card.',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    effects: [{ kind: 'heal', amount: 5 }, { kind: 'draw', count: 1 }],
    upgradeTo: 'second-breakfast-plus',
  },
  {
    id: 'shield-wall',
    // #55: dead 2-cost wall — 14 block/2 was strictly worse per energy than
    // warding-stone (8/1) and not enough of a lump to justify the 2-cost slot.
    // Drop cost 2→1 at 10 block: a modest efficiency bump over warding-stone (8/1)
    // that makes it the dedicated 1-cost "wall" common, still under bulwark
    // (uncommon, 16/2) per energy.
    name: 'Shield Wall',
    description: 'Gain 10 Block.',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    effects: [{ kind: 'block', amount: 10 }],
    upgradeTo: 'shield-wall-plus',
  },
  {
    id: 'adrenaline-rush',
    name: 'Adrenaline Rush',
    description: 'Draw 2 cards.',
    type: 'skill',
    rarity: 'uncommon',
    cost: 0,
    target: 'self',
    effects: [{ kind: 'draw', count: 2 }],
  },
  {
    id: 'flurry-of-knives',
    name: 'Flurry of Knives',
    description: 'Deal 3 damage three times.',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    effects: [{ kind: 'damage', amount: 3, target: 'enemy', times: 3 }],
    upgradeTo: 'flurry-of-knives-plus',
  },
  {
    id: 'liquid-courage',
    name: 'Liquid Courage',
    description: 'Gain 2 Strength.',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }],
  },
  {
    id: 'troll-blood',
    name: 'Troll Blood',
    description: 'Gain 4 Regen.',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    effects: [{ kind: 'applyStatus', status: 'regen', stacks: 4, target: 'self' }],
  },
  {
    id: 'lucky-dagger',
    // #42: conditional-effect identity ("×2 if poisoned"). Base 7 dmg + a
    // conditional 7 bonus when the target is poisoned (>=1), so it hits 14 when
    // a poison build is online and 7 when cold. Tuning: the old flat 11 became a
    // 7/14 swing — STRICTLY WORSE unset up (7 vs 11) and BETTER set up (14 vs 11)
    // without ballooning (14 is still a rare 2-cost, below Guillotine's 24). Keeps
    // the draw-2 so it stays a tempo-positive finisher in the poison archetype.
    name: 'Lucky Dagger',
    description: 'Deal 7 damage. If the target is Poisoned, deal 7 more. Draw 2 cards.',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    effects: [
      { kind: 'damage', amount: 7, target: 'enemy' },
      {
        kind: 'conditional',
        condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 },
        then: [{ kind: 'damage', amount: 7, target: 'enemy' }],
      },
      { kind: 'draw', count: 2 },
    ],
    upgradeTo: 'lucky-dagger-plus',
  },
  {
    id: 'last-stand',
    name: 'Last Stand',
    description: 'Gain 20 Block.',
    type: 'skill',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    effects: [{ kind: 'block', amount: 20 }],
  },
  // --- M6 content quota ---
  // Commons
  { id: 'rat-bite', name: 'Rat Bite', description: 'Deal 5 damage.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }], upgradeTo: 'rat-bite-plus' },
  { id: 'brace', name: 'Brace', description: 'Gain 5 Block.', type: 'skill', rarity: 'common', cost: 0, target: 'self', effects: [{ kind: 'block', amount: 5 }] },
  { id: 'pommel-strike', name: 'Pommel Strike', description: 'Deal 6 damage. Draw 1 card.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'draw', count: 1 }], upgradeTo: 'pommel-strike-plus' },
  { id: 'torch-jab', name: 'Torch Jab', description: 'Deal 8 damage. Apply 1 Vulnerable.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'enemy' }], upgradeTo: 'torch-jab-plus' },
  // #55: dead vanilla 2-cost attack (14 dmg, no rider) — flat damage with no
  // scaling lost to riders like crippling-blow (10+2weak). Add a +1 Strength
  // self-rider so it scales the rest of the turn/combat: 14 dmg + 1 Strength at
  // cost 2. Modest (under guillotine 24/3) and gives it a build identity.
  { id: 'heavy-swing', name: 'Heavy Swing', description: 'Deal 14 damage. Gain 1 Strength.', type: 'attack', rarity: 'common', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 14, target: 'enemy' }, { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }], upgradeTo: 'heavy-swing-plus' },
  { id: 'spiked-shield', name: 'Spiked Shield', description: 'Gain 6 Block. Deal 3 damage.', type: 'skill', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'block', amount: 6 }, { kind: 'damage', amount: 3, target: 'enemy' }] },
  { id: 'field-rations', name: 'Field Rations', description: 'Heal 4 HP. Gain 5 Block.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'heal', amount: 4 }, { kind: 'block', amount: 5 }] },
  // Uncommons
  // #42: whirlwind keeps its AoE identity but gains a single-target FLOOR via a
  // conditional — vs exactly one enemy (a lone boss/elite) it deals +5, so it is
  // no longer near-dead in single-target rooms (6→11 vs a boss, ~a Heavy-Swing).
  // Inert in multi-enemy rooms (count != 1 → no bonus), so its arc value is
  // unchanged. Tuned modestly (11 single < 14 Heavy-Swing at cost 2) so the floor
  // rescues it without making the AoE card a premier single-target attack.
  { id: 'whirlwind', name: 'Whirlwind', description: 'Deal 6 damage to all enemies. If there is only one enemy, deal 5 more.', type: 'attack', rarity: 'uncommon', cost: 2, target: 'allEnemies', effects: [{ kind: 'damage', amount: 6, target: 'allEnemies' }, { kind: 'conditional', condition: { type: 'enemyCount', op: 'eq', value: 1 }, then: [{ kind: 'damage', amount: 5, target: 'allEnemies' }] }], upgradeTo: 'whirlwind-plus' },
  { id: 'battle-trance', name: 'Battle Trance', description: 'Draw 2 cards. Gain 1 Energy.', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'draw', count: 2 }, { kind: 'gainEnergy', amount: 1 }] },
  { id: 'iron-hide', name: 'Iron Hide', description: 'Gain 3 Regen.', type: 'power', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'regen', stacks: 3, target: 'self' }] },
  // #61: DEAD uncommon (a structural inversion — it scored BELOW commons as a pure
  // 6-HP heal). Make it dual-purpose: keep the 6 heal and ADD 3 Block, giving it a
  // sustain+defense identity that lifts it into the contested uncommon band without
  // overshooting (under shield-bash's 6 dmg + 4 block tempo).
  { id: 'second-wind', name: 'Second Wind', description: 'Heal 6 HP. Gain 3 Block.', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'heal', amount: 6 }, { kind: 'block', amount: 3 }] },
  { id: 'crippling-blow', name: 'Crippling Blow', description: 'Deal 10 damage. Apply 2 Weak.', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 10, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' }], upgradeTo: 'crippling-blow-plus' },
  { id: 'shield-bash', name: 'Shield Bash', description: 'Deal 6 damage. Gain 4 Block.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'block', amount: 4 }] },
  // Rares
  { id: 'avalanche', name: 'Avalanche', description: 'Deal 12 damage to all enemies. Draw 1 card.', type: 'attack', rarity: 'rare', cost: 2, target: 'allEnemies', effects: [{ kind: 'damage', amount: 12, target: 'allEnemies' }, { kind: 'draw', count: 1 }] },
  { id: 'berserker-brew', name: 'Berserker Brew', description: 'Gain 3 Strength and 1 Dexterity.', type: 'power', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 3, target: 'self' }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  // #61: DEAD rare (a dead RARE wastes the most per offer slot, and pure heal can't
  // clear the rare bar). Lean into the phoenix REBIRTH theme: keep the 12 heal and
  // add 2 Strength so it "rises stronger from the ashes" — a sustain+offense rare
  // distinct from the block rares, landing in the contested rare band (well under
  // last-bastion / viral-load) so it's draftable but NOT a new auto-pick.
  { id: 'phoenix-feather', name: 'Phoenix Feather', description: 'Heal 12 HP. Gain 2 Strength.', type: 'skill', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'heal', amount: 12 }, { kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  { id: 'perfect-parry', name: 'Perfect Parry', description: 'Gain 10 Block. Draw 1 card.', type: 'skill', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'block', amount: 10 }, { kind: 'draw', count: 1 }] },
  { id: 'guillotine', name: 'Guillotine', description: 'Deal 24 damage.', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy', effects: [{ kind: 'damage', amount: 24, target: 'enemy' }], upgradeTo: 'guillotine-plus' },
  // --- M12 expansion: poison + dexterity archetypes ---
  // Commons
  { id: 'venom-dart', name: 'Venom Dart', description: 'Apply 3 Poison.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }], upgradeTo: 'venom-dart-plus' },
  // #67 deadcard-pass7: tipped-blade is the Apothecary STARTER (in APOTHECARY_DECK)
  // yet was also a dead DRAFTABLE common (greedy 0.00). SHELVE it from the draft
  // pool by reclassifying rarity 'common' -> 'starter' (the draft pool is
  // `rarity !== 'starter' && not an upgrade-target`), exactly like the
  // spore-burst / rusty-shortsword starter pattern. It STAYS the Apothecary
  // starter and keeps its rest-site upgrade (tipped-blade-plus). Save-safe: the
  // CardDef is kept, so saved decks holding it still resolve (no SAVE_VERSION bump).
  { id: 'tipped-blade', name: 'Tipped Blade', description: 'Deal 4 damage. Apply 2 Poison.', type: 'attack', rarity: 'starter', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 2, target: 'enemy' }], upgradeTo: 'tipped-blade-plus' },
  // #67: greedy read limber ~0.00 but MCTS drafts it across all classes (knight
  // 0.25 / apoth 0.33 / over 0.25) — `dexterity` is a scaling blind spot the
  // greedy ranking under-rates. BUFF to greedy-visibility by leaning the agility
  // (dex) identity: 1 Dex + 4 Block -> 2 Dex + 4 Block. It is the common
  // dex-archetype SEED (a touch ahead of pure-dex caltrops by design — an
  // intended enabler, not a new auto-pick: still under the uncommon dex powers).
  { id: 'limber', name: 'Limber', description: 'Gain 2 Dexterity. Gain 4 Block.', type: 'power', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 2, target: 'self' }, { kind: 'block', amount: 4 }] },
  // #55: still dead at 4 block + draw 1 — a touch light next to the draw/tempo
  // skills. Bump block 4→5 (closer to adrenaline-rush tempo) without adding a
  // second draw, so it stays a modest block-cantrip.
  // #67 deadcard-pass7: the #55 buff did not take — sidestep is the lone target
  // with NO greedy-blind-spot mechanic (plain block+draw, redundant with
  // brace / shield-wall / oath-keeper), and MCTS confirms it dead (knight 0.20 on
  // a tiny sample, apoth 0.00, over 0.10 — aggregate ~0.09, the laggard of the
  // five). CULL = SHELVE: reclassify rarity 'common' -> 'starter' so it leaves the
  // draft pool while KEEPING the CardDef (it is in NO starter deck, so it becomes
  // inert — never offered, never dealt). Save-safe (CardDef kept; no SAVE_VERSION
  // bump). No -plus to orphan.
  { id: 'sidestep', name: 'Sidestep', description: 'Gain 5 Block. Draw 1 card.', type: 'skill', rarity: 'starter', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 5 }, { kind: 'draw', count: 1 }] },
  { id: 'throwing-knife', name: 'Throwing Knife', description: 'Deal 4 damage.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
  // #55: dead pure-block common (8 block/1) — flat block with no scaling lost to
  // riders. Add a +1 Dexterity scaling rider (every future block card gets +1),
  // trimming the flat block 8→6 to pay for it: 6 block + 1 Dexterity at cost 1.
  // Sits right by limber (4 block + 1 dex, common) — a hair more block — and the
  // dex makes it a dexterity-archetype enabler rather than linear block.
  { id: 'warding-stone', name: 'Warding Stone', description: 'Gain 6 Block. Gain 1 Dexterity.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 6 }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  // #67: greedy read twin-jab ~0.00 but MCTS drafts it across classes (knight
  // 0.20 / apoth 0.09 / over 0.17) — multi-hit is a blind spot the greedy ranking
  // under-rates (each hit scales independently with Strength). BUFF to greedy-
  // visibility: 4 dmg x2 -> 5 dmg x2 (10 split damage), landing in the contested
  // goblin-stomp band. Multi-hit is worse into block than a single big hit, so the
  // raw edge over torch-jab (8) is paid for by that downside — not a new auto-pick.
  { id: 'twin-jab', name: 'Twin Jab', description: 'Deal 5 damage twice.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 5, target: 'enemy', times: 2 }] },
  // Uncommons
  // #55: dead AoE-poison uncommon — 2 poison all/1 was too thin a clock to draft.
  // Bump 2→4 poison all at cost 1. Still well under corrosive-mist (rare, 6 poison
  // all + 1 energy /2) per energy, and it seeds a real pack-wide poison clock.
  { id: 'toxic-cloud', name: 'Toxic Cloud', description: 'Apply 4 Poison to all enemies.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'allEnemies', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 4, target: 'allEnemies' }] },
  { id: 'caltrops', name: 'Caltrops', description: 'Gain 2 Dexterity.', type: 'power', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 2, target: 'self' }] },
  { id: 'rupture', name: 'Rupture', description: 'Deal 6 damage. Apply 3 Poison.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] },
  { id: 'bulwark', name: 'Bulwark', description: 'Gain 16 Block.', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self', effects: [{ kind: 'block', amount: 16 }] },
  { id: 'venom-blade', name: 'Venom Blade', description: 'Deal 5 damage. Apply 2 Poison. Draw 1 card.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 2, target: 'enemy' }, { kind: 'draw', count: 1 }] },
  // #45: POISON PAYOFF (closes the apothecary nightmare gap without class-gating).
  // Cold (target NOT poisoned) it is a plain 5-dmg 1-cost attack — strictly worse
  // than torch-jab (8 dmg)/heavy-swing per cost, so a knight rarely wants it. When
  // the target is already poisoned (apothecary's wheelhouse) it nearly triples in
  // value: +5 dmg AND +2 Poison, ACCELERATING the slow poison ramp that was losing
  // the long high-HP boss race. It REWARDS existing poison (conditional, #42) but
  // does not CONSUME it, so there is no detonate one-shot loop — the +2 poison it
  // adds still ticks down 1/round like all poison (no compounding explosion).
  { id: 'venom-reprisal', name: 'Venom Reprisal', description: 'Deal 5 damage. If the target is Poisoned, deal 5 more and apply 2 Poison.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 5, target: 'enemy' }, { kind: 'conditional', condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 }, then: [{ kind: 'damage', amount: 5, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 2, target: 'enemy' }] }], upgradeTo: 'venom-reprisal-plus' },
  { id: 'stone-skin', name: 'Stone Skin', description: 'Gain 1 Dexterity and 5 Block.', type: 'power', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }, { kind: 'block', amount: 5 }] },
  // Rares
  { id: 'viral-load', name: 'Viral Load', description: 'Apply 10 Poison. Gain 1 Energy.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 10, target: 'enemy' }, { kind: 'gainEnergy', amount: 1 }] },
  // #55: dead rare (MCTS 0.00) — pure 3 dex/2 had no immediate value, so it lost
  // to caltrops (2 dex/1 uncommon) which ramps cheaper. Add an IMMEDIATE 6 Block
  // so the turn it lands it already pays off (and the 6 block itself is boosted
  // +3 by the dex it grants this same turn). 3 Dexterity + 6 Block at cost 2 — a
  // dex-lean rare next to last-bastion (18 block + 1 dex /2), no longer dead.
  { id: 'iron-stance', name: 'Iron Stance', description: 'Gain 3 Dexterity. Gain 6 Block.', type: 'power', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 3, target: 'self' }, { kind: 'block', amount: 6 }] },
  { id: 'corrosive-mist', name: 'Corrosive Mist', description: 'Apply 6 Poison to all enemies. Gain 1 Energy.', type: 'attack', rarity: 'rare', cost: 2, target: 'allEnemies', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 6, target: 'allEnemies' }, { kind: 'gainEnergy', amount: 1 }] },
  { id: 'juggernaut', name: 'Juggernaut', description: 'Gain 2 Strength and 1 Dexterity.', type: 'power', rarity: 'rare', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  // #61: was the #1 auto-pick (~2 pts above any other rare), trivializing
  // rare-vs-rare drafts. Trim poison 5→4 to bring it in line with the other top
  // rares while keeping its identity (cheap 1-cost poison cantrip).
  { id: 'plague', name: 'Plague', description: 'Apply 4 Poison. Draw 1 card.', type: 'attack', rarity: 'rare', cost: 1, target: 'enemy', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 4, target: 'enemy' }, { kind: 'draw', count: 1 }] },
  // #54: POISON FINISHER (closes the apothecary single/nightmare PEAK-DAMAGE gap —
  // root cause was not endurance but too-slow poison ramp failing to kill the boss
  // before HP runs out). A late "close it out" burst the class lacked. Cold (target
  // NOT heavily poisoned) it is a weak 8-dmg 2-cost attack — strictly worse than
  // heavy-swing (14/2) per cost, so a KNIGHT (who almost never stacks 5+ poison)
  // rarely wants it. When the target is ALREADY heavily poisoned (poison >= 5 — the
  // apothecary's wheelhouse vs the high-HP boss by mid-fight via viral-load 10 /
  // corrosive-mist 6 / plague 5 / tipped-blade) it DETONATES for +18 fixed bonus
  // (26 total, guillotine-class burst at a cheaper cost). Distinct from #45 Venom
  // Reprisal (atLeast-1 EARLY tempo card that ACCELERATES the ramp by adding poison):
  // this is a HIGH-threshold LATE finisher with a BIG fixed payoff that adds NO
  // poison. Threshold->fixed-bonus only (no "x stacks" kind). It REWARDS existing
  // poison (conditional, #42) but never CONSUMES it — no detonate one-shot loop, and
  // it seeds no poison, so it adds no compounding combo (one-shot burst per play).
  { id: 'poison-finisher', name: 'Detonation Vial', description: 'Deal 8 damage. If the target has 5 or more Poison, deal 18 more.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'conditional', condition: { type: 'targetHasStatus', status: 'poison', atLeast: 5 }, then: [{ kind: 'damage', amount: 18, target: 'enemy' }] }], upgradeTo: 'poison-finisher-plus' },
  { id: 'last-bastion', name: 'Last Bastion', description: 'Gain 18 Block and 1 Dexterity.', type: 'skill', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'block', amount: 18 }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  // --- D1: upgraded variants ('<base>-plus'). NEVER draftable: each is some
  // other card's upgradeTo target, so the draft pool filters them out. Reachable
  // only by upgrading a base card at a rest site. No further upgradeTo (no chains).
  // Starter upgrades
  { id: 'rusty-shortsword-plus', name: 'Rusty Shortsword+', description: 'Deal 9 damage.', type: 'attack', rarity: 'starter', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }] },
  { id: 'battered-buckler-plus', name: 'Battered Buckler+', description: 'Gain 8 Block.', type: 'skill', rarity: 'starter', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 8 }] },
  { id: 'oath-keeper-plus', name: 'Oath-Keeper+', description: 'Gain 8 Block. Draw 1 card.', type: 'skill', rarity: 'starter', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 8 }, { kind: 'draw', count: 1 }] },
  { id: 'vanguard-stance-plus', name: 'Vanguard Stance+', description: 'Gain 7 Block and 1 Strength.', type: 'skill', rarity: 'starter', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 7 }, { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }] },
  { id: 'spore-burst-plus', name: 'Spore Burst+', description: 'Deal 7 damage to all enemies. Apply 2 Poison to all enemies.', type: 'attack', rarity: 'starter', cost: 1, target: 'allEnemies', effects: [{ kind: 'damage', amount: 7, target: 'allEnemies' }, { kind: 'applyStatus', status: 'poison', stacks: 2, target: 'allEnemies' }] },
  // Common upgrades
  { id: 'goblin-stomp-plus', name: 'Goblin Stomp+', description: 'Deal 14 damage. Apply 3 Vulnerable.', type: 'attack', rarity: 'common', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 14, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 3, target: 'enemy' }] },
  { id: 'cleave-the-horde-plus', name: 'Cleave the Horde+', description: 'Deal 9 damage to all enemies. Apply 2 Vulnerable to all enemies.', type: 'attack', rarity: 'common', cost: 1, target: 'allEnemies', effects: [{ kind: 'damage', amount: 9, target: 'allEnemies' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'allEnemies' }] },
  // #67: bumped in step with the base buff (5/2->6/3) to preserve the rest-site
  // upgrade gap (+2 dmg / +1 weak over base): 7 dmg/3 weak -> 8 dmg/4 weak.
  { id: 'weakening-jab-plus', name: 'Weakening Jab+', description: 'Deal 8 damage. Apply 4 Weak.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 4, target: 'enemy' }] },
  { id: 'second-breakfast-plus', name: 'Second Breakfast+', description: 'Heal 8 HP. Draw 1 card.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'heal', amount: 8 }, { kind: 'draw', count: 1 }] },
  { id: 'shield-wall-plus', name: 'Shield Wall+', description: 'Gain 14 Block.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 14 }] },
  { id: 'rat-bite-plus', name: 'Rat Bite+', description: 'Deal 8 damage.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
  { id: 'pommel-strike-plus', name: 'Pommel Strike+', description: 'Deal 9 damage. Draw 1 card.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }, { kind: 'draw', count: 1 }] },
  { id: 'torch-jab-plus', name: 'Torch Jab+', description: 'Deal 11 damage. Apply 2 Vulnerable.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 11, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' }] },
  { id: 'heavy-swing-plus', name: 'Heavy Swing+', description: 'Deal 19 damage. Gain 2 Strength.', type: 'attack', rarity: 'common', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 19, target: 'enemy' }, { kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  { id: 'venom-dart-plus', name: 'Venom Dart+', description: 'Apply 5 Poison.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 5, target: 'enemy' }] },
  { id: 'tipped-blade-plus', name: 'Tipped Blade+', description: 'Deal 6 damage. Apply 4 Poison.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 4, target: 'enemy' }] },
  // Uncommon upgrades
  { id: 'flurry-of-knives-plus', name: 'Flurry of Knives+', description: 'Deal 4 damage three times.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 4, target: 'enemy', times: 3 }] },
  { id: 'whirlwind-plus', name: 'Whirlwind+', description: 'Deal 9 damage to all enemies. If there is only one enemy, deal 6 more.', type: 'attack', rarity: 'uncommon', cost: 2, target: 'allEnemies', effects: [{ kind: 'damage', amount: 9, target: 'allEnemies' }, { kind: 'conditional', condition: { type: 'enemyCount', op: 'eq', value: 1 }, then: [{ kind: 'damage', amount: 6, target: 'allEnemies' }] }] },
  { id: 'crippling-blow-plus', name: 'Crippling Blow+', description: 'Deal 14 damage. Apply 3 Weak.', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 14, target: 'enemy' }, { kind: 'applyStatus', status: 'weak', stacks: 3, target: 'enemy' }] },
  // #45: upgraded payoff — cold stays a modest 6-dmg 1-cost; set up it hits 6+7 and
  // applies 3 Poison (a bigger ramp accelerator), still no consume/loop.
  { id: 'venom-reprisal-plus', name: 'Venom Reprisal+', description: 'Deal 6 damage. If the target is Poisoned, deal 7 more and apply 3 Poison.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'conditional', condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 }, then: [{ kind: 'damage', amount: 7, target: 'enemy' }, { kind: 'applyStatus', status: 'poison', stacks: 3, target: 'enemy' }] }] },
  // Rare upgrades
  { id: 'lucky-dagger-plus', name: 'Lucky Dagger+', description: 'Deal 9 damage. If the target is Poisoned, deal 9 more. Draw 2 cards.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 9, target: 'enemy' }, { kind: 'conditional', condition: { type: 'targetHasStatus', status: 'poison', atLeast: 1 }, then: [{ kind: 'damage', amount: 9, target: 'enemy' }] }, { kind: 'draw', count: 2 }] },
  { id: 'guillotine-plus', name: 'Guillotine+', description: 'Deal 32 damage.', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy', effects: [{ kind: 'damage', amount: 32, target: 'enemy' }] },
  // #54: upgraded finisher — cold stays a modest 10-dmg 2-cost; armed (poison >= 5)
  // it detonates for 10+22 = 32 (guillotine+-class). Threshold unchanged; still adds
  // no poison and consumes none (no loop).
  { id: 'poison-finisher-plus', name: 'Detonation Vial+', description: 'Deal 10 damage. If the target has 5 or more Poison, deal 22 more.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 10, target: 'enemy' }, { kind: 'conditional', condition: { type: 'targetHasStatus', status: 'poison', atLeast: 5 }, then: [{ kind: 'damage', amount: 22, target: 'enemy' }] }] },
  // --- E2: UNLOCKABLE extra cards. Each carries an `unlock` milestone id and is
  // EXCLUDED from the draft pool until that milestone is earned (UNLOCKABLE_CARD_IDS
  // is filtered out of rollCardChoices by default). Core cards above stay always
  // draftable, so a fresh player's pool is byte-identical to pre-E2. Balanced to
  // sit alongside same-rarity core cards. NOT upgradeable (no upgradeTo).
  // first-victory grants (one common, one uncommon) — modest, broadly useful.
  { id: 'heroic-second-wind', name: 'Heroic Second Wind', description: 'Heal 5 HP. Gain 4 Block.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'heal', amount: 5 }, { kind: 'block', amount: 4 }], unlock: 'first-victory' },
  { id: 'crawlers-resolve', name: "Crawler's Resolve", description: 'Deal 7 damage. Gain 5 Block.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 7, target: 'enemy' }, { kind: 'block', amount: 5 }], unlock: 'first-victory' },
  // arc-victory grant — an arc-flavored payoff card.
  { id: 'arc-warden', name: 'Arc Warden', description: 'Gain 12 Block and 1 Dexterity.', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self', effects: [{ kind: 'block', amount: 12 }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }], unlock: 'arc-victory' },
  // three-victories grant — a veteran's rare power.
  { id: 'veterans-edge', name: "Veteran's Edge", description: 'Gain 2 Strength and 1 Dexterity. Draw 1 card.', type: 'power', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }, { kind: 'draw', count: 1 }], unlock: 'three-victories' },
  // hard-victory grant — a hard-won aggressive rare (relic-equivalent earned same milestone).
  { id: 'hard-won-strike', name: 'Hard-Won Strike', description: 'Deal 16 damage. Apply 2 Vulnerable.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 16, target: 'enemy' }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' }], unlock: 'hard-victory' },

  // --- #63 OVERCLOCKER card pack. Two levers: `loseHp` (overheat — an
  // unblockable self-cost that FLOORS at 1, so it never kills you, only leaves
  // you fragile) and `scaleMissingHp` (the gradient — `+floor(missingHp/N)` added
  // to a damage/block amount, growing CONTINUOUSLY as you take damage, capped by
  // maxHp). The two SYNERGIZE (overheating fuels the gradient) — that is the class
  // fantasy, and loseHp+scaleMissingHp on one card is intended (e.g. power-spike).
  // GUARDRAIL: `times>1` is NEVER combined with `scaleMissingHp` (that would
  // multiply the bonus per hit — degenerate; enforced by a content.test). Numbers
  // are calibrated against existing peers: no card beats the current rare ceiling
  // (guillotine 24), the gradient swing is capped (critical-mass tops out ~21 at
  // 60 maxHp), and a sustain/defense sub-theme (feedback-loop, siphon-capacitor,
  // emergency-coolant) keeps the archetype off a death-spiral — it pairs with the
  // onCombatEnd heal relics (field-dressing/surgeons-satchel).
  // Starters (NOT draftable — starter rarity; exclusive to the Overclocker deck).
  { id: 'vent-heat', name: 'Vent Heat', description: 'Overheat: lose 3 HP (won\'t kill you). Gain 1 Energy.', type: 'skill', rarity: 'starter', cost: 0, target: 'self', effects: [{ kind: 'loseHp', amount: 3 }, { kind: 'gainEnergy', amount: 1 }], upgradeTo: 'vent-heat-plus' },
  { id: 'meltdown-jab', name: 'Meltdown Jab', description: 'Deal 5 damage, plus 1 for every 10 HP you are missing.', type: 'attack', rarity: 'starter', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 5, target: 'enemy', scaleMissingHp: 10 }], upgradeTo: 'meltdown-jab-plus' },
  // Commons.
  // reckless-swing: an overheat burst — more damage than torch-jab (8/1) but you
  // pay 2 HP for it. spark-jab: a cost-0 gradient cantrip (cold = throwing-knife
  // 4/0; scales when hurt). meltdown-strike: the bread-and-butter gradient attack
  // (cold = a shortsword; wounded it overtakes torch-jab). coolant-surge: a
  // gradient BLOCK so the class can defend WHILE hurt. feedback-loop: pseudo-
  // lifesteal sustain to offset overheat.
  { id: 'reckless-swing', name: 'Reckless Swing', description: 'Overheat: lose 2 HP (won\'t kill you). Deal 14 damage.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'damage', amount: 14, target: 'enemy' }], upgradeTo: 'reckless-swing-plus' },
  { id: 'spark-jab', name: 'Spark Jab', description: 'Deal 4 damage, plus 1 for every 10 HP you are missing.', type: 'attack', rarity: 'common', cost: 0, target: 'enemy', effects: [{ kind: 'damage', amount: 4, target: 'enemy', scaleMissingHp: 10 }] },
  { id: 'meltdown-strike', name: 'Meltdown Strike', description: 'Deal 7 damage, plus 1 for every 6 HP you are missing.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 7, target: 'enemy', scaleMissingHp: 6 }], upgradeTo: 'meltdown-strike-plus' },
  { id: 'coolant-surge', name: 'Coolant Surge', description: 'Gain 8 Block, plus 1 for every 6 HP you are missing.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 8, scaleMissingHp: 6 }], upgradeTo: 'coolant-surge-plus' },
  { id: 'feedback-loop', name: 'Feedback Loop', description: 'Deal 8 damage. Heal 3 HP.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 8, target: 'enemy' }, { kind: 'heal', amount: 3 }] },
  // Uncommons.
  // thermal-vent: an overheat cantrip (Vent Heat + a draw) — tempo near
  // battle-trance but paid in HP. overload-blast: a stronger gradient attack.
  // frost-plating: a stronger gradient block. siphon-capacitor: the heavier
  // sustain card. power-spike: the SIGNATURE dual-lever card — overheat 2 HP, then
  // a gradient strike that the very same overheat (and the fight's accrued
  // missing HP) feeds.
  { id: 'thermal-vent', name: 'Thermal Vent', description: 'Overheat: lose 2 HP (won\'t kill you). Gain 1 Energy. Draw 1 card.', type: 'skill', rarity: 'uncommon', cost: 0, target: 'self', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'gainEnergy', amount: 1 }, { kind: 'draw', count: 1 }] },
  { id: 'overload-blast', name: 'Overload Blast', description: 'Deal 9 damage, plus 1 for every 6 HP you are missing.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 9, target: 'enemy', scaleMissingHp: 6 }], upgradeTo: 'overload-blast-plus' },
  { id: 'frost-plating', name: 'Frost Plating', description: 'Gain 11 Block, plus 1 for every 6 HP you are missing.', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 11, scaleMissingHp: 6 }] },
  { id: 'siphon-capacitor', name: 'Siphon Capacitor', description: 'Deal 6 damage. Heal 4 HP.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 6, target: 'enemy' }, { kind: 'heal', amount: 4 }] },
  { id: 'power-spike', name: 'Power Spike', description: 'Overheat: lose 2 HP (won\'t kill you). Deal 7 damage, plus 1 for every 6 HP you are missing.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'damage', amount: 7, target: 'enemy', scaleMissingHp: 6 }], upgradeTo: 'power-spike-plus' },
  // Rares.
  // critical-mass: the gradient CEILING — a big late-fight hit, capped (~21 at 60
  // maxHp, under guillotine 24). overdrive-core (#68 redesign): a PAYOFF power that
  // turns the class's own overheat into permanent Strength — `overcharge 1` means
  // "whenever you overheat (lose HP), gain 1 Strength". This is GENUINELY
  // class-asymmetric: it scales with how often the deck overheats (many loseHp
  // cards for the Overclocker), and is INERT for Knight/Apothecary (no loseHp ->
  // it never fires). It replaces the old "lose 3 HP, gain 3 Strength" body, which
  // greedy auto-picked across ALL classes (a synergy-blind artifact — the
  // self-damage was only upside for the overheat deck, which greedy couldn't see).
  // Scaling is bounded by the number of overheats per fight, so it is not a
  // degenerate one-shot Strength nuke. emergency-coolant: a comeback defensive
  // rare (gradient block + a heal) so the class has a real "stabilize while
  // bloodied" answer instead of only going faster.
  { id: 'critical-mass', name: 'Critical Mass', description: 'Deal 10 damage, plus 1 for every 5 HP you are missing.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 10, target: 'enemy', scaleMissingHp: 5 }], upgradeTo: 'critical-mass-plus' },
  { id: 'overdrive-core', name: 'Overdrive Core', description: 'Power: whenever you overheat (lose HP), gain 1 Strength.', type: 'power', rarity: 'rare', cost: 1, target: 'self', effects: [{ kind: 'applyStatus', status: 'overcharge', stacks: 1, target: 'self' }] },
  { id: 'emergency-coolant', name: 'Emergency Coolant', description: 'Gain 10 Block, plus 1 for every 6 HP you are missing. Heal 4 HP.', type: 'skill', rarity: 'rare', cost: 2, target: 'self', effects: [{ kind: 'block', amount: 10, scaleMissingHp: 6 }, { kind: 'heal', amount: 4 }] },
  // chain-reaction (#64): the class's lone AoE — a GRADIENT pack-clear that closes
  // the Overclocker's known multi-enemy gap (it shipped in #63 with zero AoE, so
  // arc lagged). A glass cannon spends the fight wounded, so the same missing-HP
  // that feeds its single-target gradient also lights up this whole-room hit. cost
  // 2 rare, peer to avalanche (12 flat to all + draw) / corrosive-mist (6 poison +
  // energy): the base 8-to-all sits UNDER avalanche when healthy, and only the
  // glass cannon's deep-wound spike (~+5 at half HP, capping ~+9 near death) lifts
  // it past avalanche — earned, not free. NEVER `times>1` with scaleMissingHp
  // (content.test guard); the AoE_MULT in the static scorer keeps it a contested
  // pick (peers the rare AoE band), not an auto-pick or a single-target nuke
  // (it can't focus one enemy — it always splashes the room).
  { id: 'chain-reaction', name: 'Chain Reaction', description: 'Deal 8 damage to all enemies, plus 1 for every 6 HP you are missing.', type: 'attack', rarity: 'rare', cost: 2, target: 'allEnemies', effects: [{ kind: 'damage', amount: 8, target: 'allEnemies', scaleMissingHp: 6 }] },

  // --- #63 Overclocker upgraded variants ('<base>-plus'). NEVER draftable
  // (upgradeTo targets). Reachable only at a rest. Terminal (no further upgrade).
  { id: 'vent-heat-plus', name: 'Vent Heat+', description: 'Overheat: lose 2 HP (won\'t kill you). Gain 1 Energy.', type: 'skill', rarity: 'starter', cost: 0, target: 'self', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'gainEnergy', amount: 1 }] },
  { id: 'meltdown-jab-plus', name: 'Meltdown Jab+', description: 'Deal 7 damage, plus 1 for every 8 HP you are missing.', type: 'attack', rarity: 'starter', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 7, target: 'enemy', scaleMissingHp: 8 }] },
  { id: 'reckless-swing-plus', name: 'Reckless Swing+', description: 'Overheat: lose 2 HP (won\'t kill you). Deal 18 damage.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'damage', amount: 18, target: 'enemy' }] },
  { id: 'meltdown-strike-plus', name: 'Meltdown Strike+', description: 'Deal 10 damage, plus 1 for every 5 HP you are missing.', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 10, target: 'enemy', scaleMissingHp: 5 }] },
  { id: 'coolant-surge-plus', name: 'Coolant Surge+', description: 'Gain 11 Block, plus 1 for every 5 HP you are missing.', type: 'skill', rarity: 'common', cost: 1, target: 'self', effects: [{ kind: 'block', amount: 11, scaleMissingHp: 5 }] },
  { id: 'overload-blast-plus', name: 'Overload Blast+', description: 'Deal 12 damage, plus 1 for every 5 HP you are missing.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'damage', amount: 12, target: 'enemy', scaleMissingHp: 5 }] },
  { id: 'power-spike-plus', name: 'Power Spike+', description: 'Overheat: lose 2 HP (won\'t kill you). Deal 10 damage, plus 1 for every 5 HP you are missing.', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy', effects: [{ kind: 'loseHp', amount: 2 }, { kind: 'damage', amount: 10, target: 'enemy', scaleMissingHp: 5 }] },
  { id: 'critical-mass-plus', name: 'Critical Mass+', description: 'Deal 14 damage, plus 1 for every 5 HP you are missing.', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy', effects: [{ kind: 'damage', amount: 14, target: 'enemy', scaleMissingHp: 5 }] },
];

/**
 * Set of card ids that are SOME card's `upgradeTo` target — i.e. upgraded
 * variants. Derived from the registry so the draft/reward/shop pools can
 * exclude them: upgraded cards are only reachable by upgrading, never drafted.
 */
export const UPGRADE_TARGET_IDS: ReadonlySet<string> = new Set(
  defs.map((c) => c.upgradeTo).filter((id): id is string => id !== undefined),
);

/**
 * E2: cards that are EXTRA unlockable content (carry an `unlock` milestone id).
 * Derived from the registry so the draft pool can exclude them by default —
 * mirrors UPGRADE_TARGET_IDS. A fresh player (no unlocks) gets a pool with these
 * removed, byte-identical to pre-E2. They re-enter the pool only when their
 * milestone is earned and the id is in the run's allow set.
 */
export const UNLOCKABLE_CARD_IDS: ReadonlySet<string> = new Set(
  defs.filter((c) => c.unlock !== undefined).map((c) => c.id),
);

export const cards: Readonly<Record<string, CardDef>> = Object.fromEntries(
  defs.map((c) => [c.id, c]),
);
