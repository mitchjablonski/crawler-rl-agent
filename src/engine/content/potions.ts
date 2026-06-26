import type { PotionDef } from '../types.js';

// One-shot consumables used in combat. They compose ONLY the existing Effect
// set (no new kinds), in line with cards. Numbers are tuned to be one-card-ish
// bursts of value — a bit above a comparable card since you spend the item.
const defs: readonly PotionDef[] = [
  {
    id: 'healing-draught',
    name: 'Healing Draught',
    description: 'Heal 20 HP.',
    target: 'self',
    rarity: 'common',
    effects: [{ kind: 'heal', amount: 20 }],
  },
  {
    id: 'iron-tonic',
    name: 'Iron Tonic',
    description: 'Gain 12 Block.',
    target: 'self',
    rarity: 'common',
    effects: [{ kind: 'block', amount: 12 }],
  },
  {
    id: 'fire-flask',
    name: 'Fire Flask',
    description: 'Deal 20 damage to an enemy.',
    target: 'enemy',
    rarity: 'common',
    effects: [{ kind: 'damage', amount: 20, target: 'enemy' }],
  },
  {
    id: 'surge-draught',
    name: 'Surge Draught',
    description: 'Gain 2 Energy.',
    target: 'self',
    rarity: 'uncommon',
    effects: [{ kind: 'gainEnergy', amount: 2 }],
  },
  {
    id: 'insight-brew',
    name: 'Insight Brew',
    description: 'Draw 3 cards.',
    target: 'self',
    rarity: 'uncommon',
    effects: [{ kind: 'draw', count: 3 }],
  },
  {
    id: 'venom-vial',
    name: 'Venom Vial',
    description: 'Apply 6 Poison to an enemy.',
    target: 'enemy',
    rarity: 'common',
    effects: [{ kind: 'applyStatus', status: 'poison', stacks: 6, target: 'enemy' }],
  },
  {
    id: 'might-elixir',
    name: 'Might Elixir',
    description: 'Gain 2 Strength.',
    target: 'self',
    rarity: 'uncommon',
    effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }],
  },
  {
    id: 'firebomb-flask',
    name: 'Firebomb Flask',
    description: 'Deal 10 damage to all enemies.',
    target: 'allEnemies',
    rarity: 'uncommon',
    effects: [{ kind: 'damage', amount: 10, target: 'allEnemies' }],
  },
];

export const potions: Readonly<Record<string, PotionDef>> = Object.fromEntries(
  defs.map((p) => [p.id, p]),
);
