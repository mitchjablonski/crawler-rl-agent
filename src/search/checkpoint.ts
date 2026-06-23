import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { manifestFingerprint, type VocabManifest } from './vocab.js';

/** A trained model on disk: weights plus the exact vocab it was trained with. */
export interface Checkpoint {
  readonly fingerprint: string;
  readonly manifest: VocabManifest;
  /** Opaque model payload (e.g. flat weight arrays). Shape owned by net.ts. */
  readonly model: unknown;
}

export function saveManifest(path: string, manifest: VocabManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

export function loadManifest(path: string): VocabManifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as VocabManifest;
}

/** Bundle a model with its vocab manifest + fingerprint so the mapping travels with it. */
export function saveCheckpoint(path: string, manifest: VocabManifest, model: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const bundle: Checkpoint = { fingerprint: manifestFingerprint(manifest), manifest, model };
  writeFileSync(path, JSON.stringify(bundle));
}

export function loadCheckpoint(path: string): Checkpoint {
  return JSON.parse(readFileSync(path, 'utf-8')) as Checkpoint;
}

/**
 * Guard the append-only contract at load time. "Compatible" means `current` is a
 * superset of the checkpoint's vocab: every id the checkpoint knew still maps to
 * the same index (so old weight columns still line up). Throws otherwise — never
 * silently warm-start onto a misaligned encoder.
 */
export function assertCompatible(checkpoint: Checkpoint, current: VocabManifest): void {
  const check = (
    name: string,
    old: Readonly<Record<string, number>>,
    cur: Readonly<Record<string, number>>,
  ): void => {
    for (const [id, idx] of Object.entries(old)) {
      if (cur[id] !== idx) {
        throw new Error(
          `vocab incompatible: ${name} id "${id}" was index ${idx}, now ${cur[id] ?? 'absent'}. ` +
            `Checkpoint ${checkpoint.fingerprint} cannot warm-start this encoder.`,
        );
      }
    }
  };
  check('card', checkpoint.manifest.cards, current.cards);
  check('enemy', checkpoint.manifest.enemies, current.enemies);
  check('relic', checkpoint.manifest.relics, current.relics);
  if (checkpoint.manifest.maxEnemies !== current.maxEnemies) {
    throw new Error(
      `vocab incompatible: maxEnemies changed ${checkpoint.manifest.maxEnemies} -> ${current.maxEnemies}.`,
    );
  }
  if (checkpoint.manifest.maxHand !== current.maxHand) {
    throw new Error(
      `vocab incompatible: maxHand changed ${checkpoint.manifest.maxHand} -> ${current.maxHand}.`,
    );
  }
  // Closed-union sizes must match exactly — catches a silent status/node/phase drift
  // (e.g. StatusId 4 -> 6) that the vocab append-only check would miss.
  const struct: ReadonlyArray<[string, number | undefined, number | undefined]> = [
    ['statuses', checkpoint.manifest.statuses, current.statuses],
    ['nodeKinds', checkpoint.manifest.nodeKinds, current.nodeKinds],
    ['phases', checkpoint.manifest.phases, current.phases],
  ];
  for (const [name, a, b] of struct) {
    if (a !== b) throw new Error(`vocab incompatible: ${name} changed ${a} -> ${b} (retrain needed).`);
  }
}
