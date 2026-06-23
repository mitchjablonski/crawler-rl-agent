import type { ContentRegistry, RunState, StatusId } from '../engine/types.js';
import { MAX_ENEMIES, MAX_HAND } from './encode.js';
import { type VocabManifest, emptyManifest, extendManifest, manifestFingerprint, widthOf } from './vocab.js';

const STATUS_IDS: readonly StatusId[] = ['strength', 'vulnerable', 'weak', 'regen', 'poison', 'dexterity'];

/** Token kinds; the Python model has one embedding table per kind. */
export const TOKEN_TYPES = ['context', 'player', 'card', 'enemy'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** Per-token feature width (padded union across kinds). */
export const TOKEN_FEAT_DIM = 10;

/** 1 context + 1 player + up to MAX_HAND cards + up to MAX_ENEMIES enemies. */
export const MAX_TOKENS = 2 + MAX_HAND + MAX_ENEMIES;

export interface Token {
  /** Index into TOKEN_TYPES. */
  readonly type: number;
  /** Vocab index (card/enemy) for a learned embedding, or -1 when not applicable. */
  readonly id: number;
  /** Fixed-width per-token features, length TOKEN_FEAT_DIM. */
  readonly feats: Float32Array;
}

export interface EntityEncoder {
  readonly maxTokens: number;
  readonly featDim: number;
  /** Size of the combined card+enemy id space (cards first, then enemies). */
  readonly idVocab: number;
  readonly manifest: VocabManifest;
  readonly fingerprint: string;
  encode(state: RunState): Token[];
}

const NORM = {
  hp: 100,
  block: 50,
  gold: 200,
  energy: 10,
  turn: 30,
  status: 10,
  cost: 3,
  deck: 40,
} as const;

function feats(values: number[]): Float32Array {
  const f = new Float32Array(TOKEN_FEAT_DIM);
  for (let i = 0; i < values.length && i < TOKEN_FEAT_DIM; i++) f[i] = values[i] as number;
  return f;
}

/** Build an entity encoder. Card/enemy ids index a learned embedding in the model. */
export function createEntityEncoder(
  content: ContentRegistry,
  manifest?: VocabManifest,
): EntityEncoder {
  const m = extendManifest(
    manifest ?? emptyManifest(MAX_ENEMIES, MAX_HAND),
    content,
    MAX_ENEMIES,
    MAX_HAND,
  );
  const cardIdx = new Map<string, number>(Object.entries(m.cards));
  const enemyIdx = new Map<string, number>(Object.entries(m.enemies));
  const cardWidth = widthOf(m.cards);
  const idVocab = cardWidth + widthOf(m.enemies); // enemies live above the card ids
  const T = (t: TokenType): number => TOKEN_TYPES.indexOf(t);

  function encode(state: RunState): Token[] {
    const tokens: Token[] = [];
    const combat = state.combat;
    const bossRow = state.map.nodes[state.map.bossId]?.row ?? 1;
    const node = state.map.nodes[state.currentNodeId];

    tokens.push({
      type: T('context'),
      id: -1,
      feats: feats([
        (node?.row ?? 0) / Math.max(1, bossRow),
        state.gold / NORM.gold,
        state.deck.length / NORM.deck,
      ]),
    });

    const ps = combat?.playerStatuses ?? {};
    tokens.push({
      type: T('player'),
      id: -1,
      feats: feats([
        state.hp / Math.max(1, state.maxHp),
        (combat?.playerBlock ?? 0) / NORM.block,
        (combat?.energy ?? 0) / NORM.energy,
        (combat?.turn ?? 0) / NORM.turn,
        ...STATUS_IDS.map((s) => (ps[s] ?? 0) / NORM.status),
      ]),
    });

    if (combat) {
      combat.hand.forEach((cardId, idx) => {
        if (idx >= MAX_HAND) return;
        const card = content.cards[cardId];
        const typeOneHot = [
          card?.type === 'attack' ? 1 : 0,
          card?.type === 'skill' ? 1 : 0,
          card?.type === 'power' ? 1 : 0,
        ];
        tokens.push({
          type: T('card'),
          id: cardIdx.get(cardId) ?? -1,
          feats: feats([
            (card?.cost ?? 0) / NORM.cost,
            card && combat.energy >= card.cost ? 1 : 0,
            ...typeOneHot,
          ]),
        });
      });

      combat.enemies.forEach((en, idx) => {
        if (idx >= MAX_ENEMIES) return;
        const moves = content.enemies[en.defId]?.moves.length ?? 1;
        const eIdx = enemyIdx.get(en.defId);
        tokens.push({
          type: T('enemy'),
          id: eIdx === undefined ? -1 : cardWidth + eIdx,
          feats: feats([
            en.maxHp > 0 ? en.hp / en.maxHp : 0,
            en.block / NORM.block,
            moves > 0 ? en.nextMoveIndex / moves : 0,
            ...STATUS_IDS.map((s) => (en.statuses[s] ?? 0) / NORM.status),
          ]),
        });
      });
    }

    return tokens;
  }

  return {
    maxTokens: MAX_TOKENS,
    featDim: TOKEN_FEAT_DIM,
    idVocab,
    manifest: m,
    fingerprint: manifestFingerprint(m),
    encode,
  };
}
