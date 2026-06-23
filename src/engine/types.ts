import type { RngStreams } from './rng.js';

// ---- Effects: the closed primitive set every system composes from ----

export type TargetKind = 'enemy' | 'allEnemies' | 'self';
export type StatusId = 'strength' | 'vulnerable' | 'weak' | 'regen' | 'poison' | 'dexterity';

export type Effect =
  | { kind: 'damage'; amount: number; target: TargetKind; times?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'draw'; count: number }
  | { kind: 'gainEnergy'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target: TargetKind };

export type Statuses = Partial<Readonly<Record<StatusId, number>>>;

// ---- Content definitions (data, injected via ContentRegistry) ----

export type CardType = 'attack' | 'skill' | 'power';
export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare';

export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: CardType;
  readonly rarity: Rarity;
  readonly cost: number;
  /** What the player must select when playing this card. */
  readonly target: TargetKind;
  readonly effects: readonly Effect[];
}

/** In enemy moves, target 'enemy' means the player. */
export interface EnemyMove {
  readonly name: string;
  readonly effects: readonly Effect[];
}

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  readonly hp: readonly [min: number, max: number];
  /** Moves cycle in order from a random starting index. */
  readonly moves: readonly EnemyMove[];
  readonly isElite?: boolean;
  readonly isBoss?: boolean;
  /** Normal-enemy act tier (1-3, default 1); higher tiers appear deeper in an arc. */
  readonly tier?: number;
}

export interface RelicDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: 'combatStart' | 'turnStart';
  readonly effects: readonly Effect[];
}

export type EventOutcome =
  | { kind: 'gainGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'loseHp'; amount: number }
  | { kind: 'gainMaxHp'; amount: number }
  | { kind: 'gainCard'; cardId: string }
  | { kind: 'gainRelic'; relicId: string };

export interface NarrativeEventDef {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly options: readonly {
    readonly label: string;
    readonly outcomes: readonly EventOutcome[];
  }[];
}

export interface ContentRegistry {
  readonly cards: Readonly<Record<string, CardDef>>;
  readonly enemies: Readonly<Record<string, EnemyDef>>;
  readonly relics: Readonly<Record<string, RelicDef>>;
  readonly events: Readonly<Record<string, NarrativeEventDef>>;
}

// ---- Map ----

export type NodeKind = 'start' | 'combat' | 'elite' | 'event' | 'shop' | 'rest' | 'boss';

export interface MapNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly row: number;
  /** 0-indexed act this node belongs to (single mode = all act 0). */
  readonly act: number;
  readonly next: readonly string[];
}

export interface RunMap {
  readonly nodes: Readonly<Record<string, MapNode>>;
  readonly startId: string;
  readonly bossId: string;
}

// ---- Combat ----

export interface EnemyInstance {
  readonly defId: string;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly block: number;
  readonly statuses: Statuses;
  readonly nextMoveIndex: number;
}

export interface CombatState {
  readonly enemies: readonly EnemyInstance[];
  /** Card def ids. M1 has no per-instance card state (no upgrades yet). */
  readonly hand: readonly string[];
  readonly drawPile: readonly string[];
  readonly discardPile: readonly string[];
  readonly energy: number;
  readonly maxEnergy: number;
  /** Player HP is copied in at combat start and synced back at combat end. */
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly playerBlock: number;
  readonly playerStatuses: Statuses;
  readonly turn: number;
}

// ---- Run ----

export type Phase =
  | 'map'
  | 'combat'
  | 'reward'
  | 'shop'
  | 'rest'
  | 'event'
  | 'victory'
  | 'defeat';

/** Pending effects granted by bounded modifiers (REQ-5). */
export interface RunModifiers {
  readonly nextCombatStatuses: Statuses;
  readonly queuedEliteIds: readonly string[];
}

export interface RunState {
  readonly seed: string;
  readonly rng: RngStreams;
  readonly map: RunMap;
  readonly currentNodeId: string;
  readonly phase: Phase;
  readonly hp: number;
  readonly maxHp: number;
  readonly gold: number;
  readonly deck: readonly string[];
  readonly relics: readonly string[];
  readonly combat: CombatState | null;
  readonly reward: {
    readonly cards: readonly string[];
    readonly gold: number;
    readonly relicId?: string;
  } | null;
  readonly shop: { readonly stock: readonly { readonly cardId: string; readonly price: number; readonly sold: boolean }[] } | null;
  readonly event: { readonly eventId: string } | null;
  readonly modifiers: RunModifiers;
  /** Difficulty enemy-HP multiplier baked into this run (1 = neutral). */
  readonly enemyHpMult: number;
}

export type GameAction =
  | { type: 'chooseNode'; nodeId: string }
  | { type: 'playCard'; handIndex: number; targetIndex?: number }
  | { type: 'endTurn' }
  | { type: 'pickRewardCard'; index: number }
  | { type: 'skipReward' }
  | { type: 'buyCard'; index: number }
  | { type: 'leaveShop' }
  | { type: 'rest' }
  | { type: 'chooseEventOption'; index: number };

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Safe boundaries are where saves happen and where queued modifiers may
 * apply (REQ-5, REQ-9). The engine — not callers — defines them.
 */
export function isSafeBoundary(state: RunState): boolean {
  return state.phase !== 'combat';
}
