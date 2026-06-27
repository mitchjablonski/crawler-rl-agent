// Append-only vocabulary manifest. Persisted alongside a trained model so the
// exact id->index mapping it was trained with can be reloaded, and so new
// content can be added across versions WITHOUT shifting existing indices
// (enabling warm-start). Deletions leave a reserved slot (tombstone); indices
// are never reused.

export const VOCAB_VERSION = 1;

export interface VocabManifest {
  readonly version: number;
  /** card id -> slot index. Append-only; never renumbered. */
  readonly cards: Readonly<Record<string, number>>;
  readonly enemies: Readonly<Record<string, number>>;
  readonly relics: Readonly<Record<string, number>>;
  /** potion id -> slot index. Append-only (M38 mechanic). Optional for pre-M38 manifests. */
  readonly potions?: Readonly<Record<string, number>>;
  /** Structural constants captured for compatibility / fingerprinting. */
  readonly maxEnemies: number;
  readonly maxHand: number;
  /** Closed-union sizes (status/node/phase). Stamped by createEncoder; guards silent drift. */
  readonly statuses?: number;
  readonly nodeKinds?: number;
  readonly phases?: number;
  /** Max act tiers the encoder reserves a one-hot for (multi-arc support). Stamped by createEncoder. */
  readonly acts?: number;
  /** Number of playable classes the encoder reserves a one-hot for. Stamped by createEncoder. */
  readonly classes?: number;
}

export function emptyManifest(maxEnemies: number, maxHand: number): VocabManifest {
  return { version: VOCAB_VERSION, cards: {}, enemies: {}, relics: {}, maxEnemies, maxHand };
}

/** Width of a slot map: highest index + 1 (0 if empty). Preserves tombstone gaps. */
export function widthOf(map: Readonly<Record<string, number>>): number {
  let max = -1;
  for (const i of Object.values(map)) if (i > max) max = i;
  return max + 1;
}

function extendMap(
  existing: Readonly<Record<string, number>>,
  ids: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = { ...existing };
  let next = widthOf(existing);
  // Deterministic: new ids are assigned in sorted order from the next free slot.
  for (const id of [...ids].sort()) {
    if (out[id] === undefined) out[id] = next++;
  }
  return out;
}

/**
 * Return a manifest covering every id in `content`, preserving all existing
 * id->index assignments and appending new ids at the end. Pure — callers persist
 * the result so the mapping survives with the model.
 */
export function extendManifest(
  manifest: VocabManifest,
  content: {
    readonly cards: object;
    readonly enemies: object;
    readonly relics: object;
    readonly potions?: object;
  },
  maxEnemies: number,
  maxHand: number,
): VocabManifest {
  return {
    version: VOCAB_VERSION,
    cards: extendMap(manifest.cards, Object.keys(content.cards)),
    enemies: extendMap(manifest.enemies, Object.keys(content.enemies)),
    relics: extendMap(manifest.relics, Object.keys(content.relics)),
    potions: extendMap(manifest.potions ?? {}, Object.keys(content.potions ?? {})),
    maxEnemies,
    maxHand,
    // Preserve the closed-union signature from the input manifest (createEncoder stamps it).
    statuses: manifest.statuses,
    nodeKinds: manifest.nodeKinds,
    phases: manifest.phases,
    acts: manifest.acts,
    classes: manifest.classes,
  };
}

/** Stable FNV-1a hash of the canonical manifest, for stamping/validating checkpoints. */
export function manifestFingerprint(m: VocabManifest): string {
  const canonical = (map: Readonly<Record<string, number>>): string =>
    Object.keys(map)
      .sort()
      .map((k) => `${k}:${map[k]}`)
      .join(',');
  const s = [
    `v${m.version}`,
    `e${m.maxEnemies}`,
    `h${m.maxHand}`,
    `st${m.statuses ?? 0}`,
    `nk${m.nodeKinds ?? 0}`,
    `ph${m.phases ?? 0}`,
    `ac${m.acts ?? 0}`,
    `cl${m.classes ?? 0}`,
    `c{${canonical(m.cards)}}`,
    `n{${canonical(m.enemies)}}`,
    `r{${canonical(m.relics)}}`,
    `p{${canonical(m.potions ?? {})}}`,
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
