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
];

export const relics: Readonly<Record<string, RelicDef>> = Object.fromEntries(
  defs.map((r) => [r.id, r]),
);
