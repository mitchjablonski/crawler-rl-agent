import type {
  ContentRegistry,
  NodeKind,
  Phase,
  RunState,
  StatusId,
} from '../engine/types.js';
import { CHARACTERS, CHARACTER_IDS } from '../engine/content/characters.js';
import {
  emptyManifest,
  extendManifest,
  manifestFingerprint,
  widthOf,
  type VocabManifest,
} from './vocab.js';

/** Fixed, ordered vocabularies for the closed unions in engine/types.ts. */
// Must match StatusId in engine/types.ts. The structural-signature guard (statuses
// count in the manifest fingerprint) makes any drift loud instead of silent.
const STATUS_IDS: readonly StatusId[] = ['strength', 'vulnerable', 'weak', 'regen', 'poison', 'dexterity'];
const NODE_KINDS: readonly NodeKind[] = ['start', 'combat', 'elite', 'event', 'shop', 'rest', 'boss'];
const PHASES: readonly Phase[] = ['map', 'combat', 'reward', 'shop', 'rest', 'event', 'victory', 'defeat'];

/** Up to 2 normal + 1 queued elite per encounter (rollEncounter in run.ts); 4 = headroom. */
export const MAX_ENEMIES = 4;

/** Hand positions encoded/acted-on. Shared with mask.ts so input slots align with playCard handIndex. */
export const MAX_HAND = 10;

/**
 * Act tiers the encoder reserves a one-hot for. The arc is 1–3 acts (run.ts/map.ts),
 * so 3 covers the live game with no headroom waste; act >= MAX_ACTS clamps to the last
 * slot. Folded into the manifest fingerprint so changing it forces an explicit retrain.
 */
export const MAX_ACTS = 3;

/**
 * Playable classes the encoder reserves a one-hot for. One shared, class-conditioned net
 * plays every class; the class is a categorical signal the deck encoding only implies.
 * RunState carries no class id, so we infer it from the *signature* starter cards that
 * persist in the deck (cards unique to one class's opening hand) — robust early, where the
 * class matters most, and it degrades gracefully to "unknown" once those starters are gone.
 */
export const CLASS_IDS: readonly string[] = CHARACTER_IDS;
export const MAX_CLASSES = CLASS_IDS.length;
/** Base signature cards per class: starters unique to that class. createEncoder expands these
 *  with their upgraded variants so a rest-site upgrade doesn't blank the class bit. */
const CLASS_BASE_SIGNATURES: ReadonlyArray<readonly string[]> = CLASS_IDS.map((id) => {
  const own = new Set(CHARACTERS[id]?.starterDeck ?? []);
  const others = new Set(
    CLASS_IDS.filter((o) => o !== id).flatMap((o) => CHARACTERS[o]?.starterDeck ?? []),
  );
  return [...own].filter((c) => !others.has(c));
});

/** Denominators that keep raw magnitudes roughly in [0,1] without clipping signal. */
const NORM = { hp: 100, block: 50, gold: 200, energy: 10, turn: 30, status: 10 } as const;

/** Per enemy slot: alive flag, hp fraction, block, one scalar per status, telegraphed-move fraction. */
const ENEMY_SLOT_WIDTH = 1 + 1 + 1 + STATUS_IDS.length + 1;

/** Per hand-position extras beyond the card one-hot: present flag, playable (cost<=energy) flag. */
const HAND_SLOT_EXTRAS = 2;

/** Names of the contiguous segments that make up the observation vector. */
export type EncoderField =
  | 'deck'
  | 'hand'
  | 'draw'
  | 'discard'
  | 'enemyCounts'
  | 'enemySlots'
  | 'handSlots'
  | 'relics'
  | 'player'
  | 'playerStatuses'
  | 'phase'
  | 'nodeKind'
  | 'rowFrac'
  | 'act'
  | 'class'
  | 'heldPotions'
  | 'potionFill';

/** [offset, length] for each field. A finite key union keeps access non-optional. */
export type EncoderLayout = Readonly<
  Record<EncoderField, readonly [offset: number, length: number]>
>;

export interface Encoder {
  /** Length of every vector produced by encode(). */
  readonly size: number;
  /** [offset, length] of each named field, for tests and the net head. */
  readonly layout: EncoderLayout;
  /** The vocab mapping this encoder uses — persist it with any trained model. */
  readonly manifest: VocabManifest;
  /** Stable hash of the manifest; stamp checkpoints with it. */
  readonly fingerprint: string;
  encode(state: RunState): Float32Array;
}

/**
 * Build a state encoder bound to a content registry and (optionally) an existing
 * vocab manifest. The manifest is extended append-only to cover `content`, so
 * card/enemy/relic slot indices stay stable across game versions — a model
 * trained on an older manifest can warm-start on the returned one. RunState.rng
 * is deliberately excluded (doc §6: encoding the raw stream state would leak all
 * future randomness into the observation).
 */
export interface EncoderOptions {
  /** Encode the hand positionally (one-hot per hand position). Default true. */
  readonly positionalHand?: boolean;
}

export function createEncoder(
  content: ContentRegistry,
  manifest?: VocabManifest,
  options?: EncoderOptions,
): Encoder {
  // maxHand=0 disables the positional-hand block (bag-of-counts only). A provided
  // manifest's maxHand wins so the encoder matches the model it was trained with.
  const requestedHand = (options?.positionalHand ?? true) ? MAX_HAND : 0;
  const baseManifest = manifest ?? emptyManifest(MAX_ENEMIES, requestedHand);
  const handPositions = baseManifest.maxHand;
  const m: VocabManifest = {
    ...extendManifest(baseManifest, content, MAX_ENEMIES, handPositions),
    // Structural signature of the closed unions — folded into the fingerprint so a
    // status/node/phase change is caught by assertCompatible, not silently mis-encoded.
    statuses: STATUS_IDS.length,
    nodeKinds: NODE_KINDS.length,
    phases: PHASES.length,
    acts: MAX_ACTS,
    classes: MAX_CLASSES,
  };
  const cards = new Map<string, number>(Object.entries(m.cards));
  const enemies = new Map<string, number>(Object.entries(m.enemies));
  const relics = new Map<string, number>(Object.entries(m.relics));
  const potions = new Map<string, number>(Object.entries(m.potions ?? {}));
  const C = widthOf(m.cards);
  const E = widthOf(m.enemies);
  const R = widthOf(m.relics);
  const P = widthOf(m.potions ?? {});
  const S = STATUS_IDS.length;

  // Expand each class's base signature with its cards' upgraded variants, so the class one-hot
  // survives a rest-site upgrade (which swaps a deck id for its `upgradeTo`).
  const classSignatures: string[][] = CLASS_BASE_SIGNATURES.map((sigs) => {
    const out = new Set<string>(sigs);
    for (const c of sigs) {
      const up = content.cards[c]?.upgradeTo;
      if (up) out.add(up);
    }
    return [...out];
  });

  const layout = {} as Record<EncoderField, readonly [number, number]>;
  let off = 0;
  const add = (name: EncoderField, len: number): void => {
    layout[name] = [off, len];
    off += len;
  };
  add('deck', C);
  add('hand', C);
  add('draw', C);
  add('discard', C);
  add('enemyCounts', E);
  add('enemySlots', MAX_ENEMIES * ENEMY_SLOT_WIDTH);
  add('handSlots', handPositions * (C + HAND_SLOT_EXTRAS));
  add('relics', R);
  add('player', 6); // hp, maxHp, block, gold, energy, turn
  add('playerStatuses', S);
  add('phase', PHASES.length);
  add('nodeKind', NODE_KINDS.length);
  add('rowFrac', 1);
  add('act', MAX_ACTS); // which act tier (one-hot) — distinguishes arcs that rowFrac alone blurs
  add('heldPotions', P); // bag-of-counts over the held satchel (M38 consumables)
  add('potionFill', 1); // satchel fill fraction (held / maxPotions) — capacity awareness
  add('class', MAX_CLASSES); // which class (one-hot) — kept LAST so the block is purely additive
  const size = off;

  const countInto = (
    v: Float32Array,
    base: number,
    ids: readonly string[],
    index: Map<string, number>,
  ): void => {
    for (const id of ids) {
      const i = index.get(id);
      if (i !== undefined) v[base + i] = (v[base + i] ?? 0) + 1;
    }
  };

  function encode(state: RunState): Float32Array {
    const v = new Float32Array(size);
    const combat = state.combat;

    countInto(v, layout.deck[0], state.deck, cards);
    if (combat) {
      countInto(v, layout.hand[0], combat.hand, cards);
      countInto(v, layout.draw[0], combat.drawPile, cards);
      countInto(v, layout.discard[0], combat.discardPile, cards);

      const ecBase = layout.enemyCounts[0];
      const slotBase = layout.enemySlots[0];
      combat.enemies.forEach((en, idx) => {
        const ei = enemies.get(en.defId);
        if (ei !== undefined && en.hp > 0) v[ecBase + ei] = (v[ecBase + ei] ?? 0) + 1;
        if (idx >= MAX_ENEMIES) return;
        const b = slotBase + idx * ENEMY_SLOT_WIDTH;
        v[b] = en.hp > 0 ? 1 : 0;
        v[b + 1] = en.maxHp > 0 ? en.hp / en.maxHp : 0;
        v[b + 2] = en.block / NORM.block;
        STATUS_IDS.forEach((s, si) => {
          v[b + 3 + si] = (en.statuses[s] ?? 0) / NORM.status;
        });
        const moves = content.enemies[en.defId]?.moves.length ?? 1;
        v[b + 3 + S] = moves > 0 ? Math.min(1, Math.max(0, en.nextMoveIndex / moves)) : 0;
      });

      // Positional hand: per-position card one-hot + present + playable, aligned to
      // the playCard handIndex action slots so the policy head can attribute value
      // to the specific card at each hand position.
      const hsBase = layout.handSlots[0];
      const slotW = C + HAND_SLOT_EXTRAS;
      combat.hand.forEach((cardId, idx) => {
        if (idx >= handPositions) return;
        const b = hsBase + idx * slotW;
        const ci = cards.get(cardId);
        if (ci !== undefined) v[b + ci] = 1;
        v[b + C] = 1; // present
        const card = content.cards[cardId];
        v[b + C + 1] = card && combat.energy >= card.cost ? 1 : 0; // playable
      });
    }

    const rBase = layout.relics[0];
    for (const id of state.relics) {
      const i = relics.get(id);
      if (i !== undefined) v[rBase + i] = 1;
    }

    // Held potions: bag-of-counts (a potion can be held more than once) + satchel fill.
    countInto(v, layout.heldPotions[0], state.potions, potions);
    v[layout.potionFill[0]] = state.maxPotions > 0 ? state.potions.length / state.maxPotions : 0;

    const p = layout.player[0];
    v[p] = state.hp / NORM.hp;
    v[p + 1] = state.maxHp / NORM.hp;
    v[p + 2] = (combat?.playerBlock ?? 0) / NORM.block;
    v[p + 3] = state.gold / NORM.gold;
    v[p + 4] = (combat?.energy ?? 0) / NORM.energy;
    v[p + 5] = (combat?.turn ?? 0) / NORM.turn;

    const ps = layout.playerStatuses[0];
    const pst = combat?.playerStatuses ?? {};
    STATUS_IDS.forEach((s, si) => {
      v[ps + si] = (pst[s] ?? 0) / NORM.status;
    });

    const phIdx = PHASES.indexOf(state.phase);
    if (phIdx >= 0) v[layout.phase[0] + phIdx] = 1;

    const node = state.map.nodes[state.currentNodeId];
    if (node) {
      const nk = NODE_KINDS.indexOf(node.kind);
      if (nk >= 0) v[layout.nodeKind[0] + nk] = 1;
      // Act one-hot (clamped to the reserved tiers): a categorical "which arc" signal the
      // continuous global rowFrac can't separate (deeper acts draw harder enemy pools).
      const act = Math.min(Math.max(node.act, 0), MAX_ACTS - 1);
      v[layout.act[0] + act] = 1;
    }
    const bossRow = state.map.nodes[state.map.bossId]?.row ?? 1;
    v[layout.rowFrac[0]] = (node?.row ?? 0) / Math.max(1, bossRow);

    // Class one-hot: argmax over how many of each class's signature cards (incl. upgraded
    // variants) survive in the master deck. Zero (unknown) if none remain — the deck/maxHp
    // encoding carries it from there. Signature sets are tiny, so a direct scan beats a Set.
    let bestClass = -1;
    let bestCount = 0;
    for (let ci = 0; ci < classSignatures.length; ci++) {
      let count = 0;
      for (const sig of classSignatures[ci] ?? []) if (state.deck.includes(sig)) count++;
      if (count > bestCount) { bestCount = count; bestClass = ci; }
    }
    if (bestClass >= 0) v[layout.class[0] + bestClass] = 1;

    return v;
  }

  return { size, layout, encode, manifest: m, fingerprint: manifestFingerprint(m) };
}
