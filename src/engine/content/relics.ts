import type { RelicDef } from '../types.js';

const defs: readonly RelicDef[] = [
  {
    id: 'pocket-dice',
    name: 'Pocket Dice',
    description: 'At the start of each combat, draw 1 extra card.',
    trigger: 'combatStart',
    effects: [{ kind: 'draw', count: 1 }],
  },
  {
    id: 'old-warhorn',
    name: 'Old Warhorn',
    description: 'At the start of each combat, gain 1 Strength and draw 1 card.',
    trigger: 'combatStart',
    effects: [
      { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' },
      { kind: 'draw', count: 1 },
    ],
  },
  {
    id: 'graphite-talisman',
    name: 'Graphite Talisman',
    description: 'At the start of each turn (after the first), gain 2 Block.',
    trigger: 'turnStart',
    effects: [{ kind: 'block', amount: 2 }],
  },
  // --- M6 content quota ---
  { id: 'troll-tooth', name: 'Troll Tooth', description: 'At the start of each combat, heal 3 HP.', trigger: 'combatStart', effects: [{ kind: 'heal', amount: 3 }] },
  { id: 'banner-of-the-crawl', name: 'Banner of the Crawl', description: 'At the start of each combat, gain 8 Block.', trigger: 'combatStart', effects: [{ kind: 'block', amount: 8 }] },
  { id: 'lucky-coin', name: 'Lucky Coin', description: 'At the start of each combat, gain 1 Energy.', trigger: 'combatStart', effects: [{ kind: 'gainEnergy', amount: 1 }] },
  { id: 'moss-amulet', name: 'Moss Amulet', description: 'At the start of each turn (after the first), heal 2 HP.', trigger: 'turnStart', effects: [{ kind: 'heal', amount: 2 }] },
  { id: 'whetstone', name: 'Whetstone', description: 'At the start of each combat, gain 2 Strength.', trigger: 'combatStart', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }] },
  // --- M12 expansion ---
  { id: 'iron-brand', name: 'Iron Brand', description: 'At the start of each combat, gain 1 Dexterity.', trigger: 'combatStart', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  { id: 'war-paint', name: 'War Paint', description: 'At the start of each combat, gain 1 Strength and 1 Dexterity.', trigger: 'combatStart', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },
  { id: 'bulwark-charm', name: 'Bulwark Charm', description: 'At the start of each combat, gain 10 Block.', trigger: 'combatStart', effects: [{ kind: 'block', amount: 10 }] },
  { id: 'second-stomach', name: 'Second Stomach', description: 'At the start of each combat, heal 6 HP.', trigger: 'combatStart', effects: [{ kind: 'heal', amount: 6 }] },
  // --- D4: richer trigger points (onCardPlayed / onKill) + a comeback conditional ---
  // onKill relics: bounded by the (few) kills a single card can land; each kill
  // fires once. Modest per-kill payoffs keep AoE multi-kills fair.
  { id: 'bloodthirster', name: 'Bloodthirster', description: 'Whenever a card you play kills an enemy, gain 1 Strength.', trigger: 'onKill', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }] },
  { id: 'gravediggers-glove', name: "Gravedigger's Glove", description: 'Whenever a card you play kills an enemy, draw 1 card.', trigger: 'onKill', effects: [{ kind: 'draw', count: 1 }] },
  { id: 'reapers-tithe', name: "Reaper's Tithe", description: 'Whenever a card you play kills an enemy, heal 3 HP.', trigger: 'onKill', effects: [{ kind: 'heal', amount: 3 }] },
  // onCardPlayed relics fire once per card — they stack across a turn quickly, so
  // payoffs are kept to 1.
  { id: 'tempo-band', name: 'Tempo Band', description: 'Every time you play a card, gain 1 Block.', trigger: 'onCardPlayed', effects: [{ kind: 'block', amount: 1 }] },
  // Comeback conditional: only fires while below half HP — high value but gated to
  // moments of real danger, so it never compounds an already-winning fight.
  { id: 'cornered-instinct', name: 'Cornered Instinct', description: 'At the start of each turn, if below 50% HP, gain 6 Block.', trigger: 'turnStart', condition: { kind: 'hpBelow', pct: 50 }, effects: [{ kind: 'block', amount: 6 }] },
  { id: 'last-ember', name: 'Last Ember', description: 'At the start of each turn, if below 40% HP, gain 1 Strength.', trigger: 'turnStart', condition: { kind: 'hpBelow', pct: 40 }, effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }] },
  // --- E2: UNLOCKABLE extra relics. Each carries an `unlock` milestone id and is
  // EXCLUDED from the elite-relic pool until that milestone is earned
  // (UNLOCKABLE_RELIC_IDS is filtered out by default). Core relics above stay
  // always available, so a fresh player's relic pool is byte-identical to pre-E2.
  { id: 'hard-won-medallion', name: 'Hard-Won Medallion', description: 'At the start of each combat, gain 1 Strength and 6 Block.', trigger: 'combatStart', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }, { kind: 'block', amount: 6 }], unlock: 'hard-victory' },
  { id: 'trophy-rack', name: 'Trophy Rack', description: 'Whenever a card you play kills an enemy, heal 2 HP and gain 1 Block.', trigger: 'onKill', effects: [{ kind: 'heal', amount: 2 }, { kind: 'block', amount: 1 }], unlock: 'three-victories' },
  { id: 'veterans-banner', name: "Veteran's Banner", description: 'At the start of each combat, gain 1 Strength, 1 Dexterity and 5 Block.', trigger: 'combatStart', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }, { kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }, { kind: 'block', amount: 5 }], unlock: 'three-victories' },
];

export const relics: Readonly<Record<string, RelicDef>> = Object.fromEntries(
  defs.map((r) => [r.id, r]),
);

/**
 * E2: relics that are EXTRA unlockable content (carry an `unlock` milestone id).
 * Derived from the registry so the elite-relic pool can exclude them by default.
 * A fresh player gets the pool with these removed (byte-identical to pre-E2);
 * they re-enter only when their milestone is earned and the id is allowed.
 */
export const UNLOCKABLE_RELIC_IDS: ReadonlySet<string> = new Set(
  defs.filter((r) => r.unlock !== undefined).map((r) => r.id),
);
