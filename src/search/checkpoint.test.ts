import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { content } from '../engine/content/index.js';
import type { CardDef } from '../engine/types.js';
import { MAX_ENEMIES, MAX_HAND, createEncoder } from './encode.js';
import { extendManifest } from './vocab.js';
import { type Checkpoint, assertCompatible, loadCheckpoint, saveCheckpoint } from './checkpoint.js';

const sampleCard: CardDef = Object.values(content.cards)[0]!;

describe('checkpoint', () => {
  it('round-trips a checkpoint and stamps the fingerprint', () => {
    const enc = createEncoder(content);
    const dir = mkdtempSync(join(tmpdir(), 'ckpt-'));
    const path = join(dir, 'model.json');
    try {
      saveCheckpoint(path, enc.manifest, { weights: [1, 2, 3] });
      const loaded = loadCheckpoint(path);
      expect(loaded.fingerprint).toBe(enc.fingerprint);
      expect(loaded.manifest).toEqual(enc.manifest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts an append-only superset (warm-start ok)', () => {
    const base = createEncoder(content);
    const checkpoint: Checkpoint = {
      fingerprint: base.fingerprint,
      manifest: base.manifest,
      model: null,
    };
    const grown = extendManifest(
      base.manifest,
      { ...content, cards: { ...content.cards, 'zzz-new': sampleCard } },
      MAX_ENEMIES,
      MAX_HAND,
    );
    expect(() => assertCompatible(checkpoint, grown)).not.toThrow();
  });

  it('rejects a closed-union (status count) drift — the silent-bug guard', () => {
    const base = createEncoder(content);
    const checkpoint: Checkpoint = {
      fingerprint: base.fingerprint,
      manifest: base.manifest,
      model: null,
    };
    const drifted = { ...base.manifest, statuses: (base.manifest.statuses ?? 6) + 1 };
    expect(() => assertCompatible(checkpoint, drifted)).toThrow(/statuses/);
  });

  it('rejects a manifest where a known id moved', () => {
    const base = createEncoder(content);
    const checkpoint: Checkpoint = {
      fingerprint: base.fingerprint,
      manifest: base.manifest,
      model: null,
    };
    const firstId = Object.keys(base.manifest.cards).sort()[0]!;
    const moved = { ...base.manifest, cards: { ...base.manifest.cards, [firstId]: 999 } };
    expect(() => assertCompatible(checkpoint, moved)).toThrow(/incompatible/);
  });
});
