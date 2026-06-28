# Experiment: does richer combat info lift the no-search ceiling?

The methodology review raised a hypothesis: the no-search policy plateau might be partly an
**encoder-information** problem (the observation isn't a sufficient statistic), not only a
learning/target problem. A concrete, decision-relevant feature the encoder *discarded*: **enemy
intent**. The encoder stored only `nextMoveIndex / moves` (a bare fraction); the player actually sees
the telegraphed move's **damage / block / effect** — the core "block or attack?" signal.

## What we added (`enemyIntent` encoder option, default off)

Per enemy slot, 5 concrete-intent features from `resolveEnemyMove`: telegraphed damage to the player,
block the enemy gains, and attack / defend / debuff flags — **+5 × 4 enemy slots = +20** to the
observation (439 → 459 in the training config, which uses `positionalHand: false`; the default
positional-hand encoder is larger but grows by the same +20). The
enemy's strength and the player's vulnerable are already encoded, so the net can combine them into
effective damage. The choice is stamped in the manifest (`enemyIntent`) so a checkpoint reloads with
its trained layout, and the new **`obsSize` fingerprint guard** catches any layout drift at load.

## A/B (identical params + training data, only the encoder differs)

Two unified nets trained on the same `class × difficulty × arc` DAgger grid (one `--intent=0`, one
`--intent=1`), then **no-search** win rate over 120 held-out seeds (95% Wilson intervals):

| Cell | baseline (obs 439) | + intent (obs 459) |
| --- | --- | --- |
| knight @1.0× | 78% [70–85] | 73% [65–80] |
| knight @1.5× | 19% [13–27] | 23% [17–32] |
| apothecary @1.0× | 67% [58–74] | 39% [31–48] |
| apothecary @1.5× | 13% [8–21] | 6% [3–12] |

**⚠️ This first run was confounded** — `unified.ts` saved the *last* DAgger round, and the intent
arm's final round drew a bad apothecary net (47% in the training log). Once that was fixed (best-round
checkpoint selection, PR #17), the picture changed; see below.

## Corrected result: a small, *seed-dependent* lift (not robust enough to adopt)

Re-ran the A/B with **best-round selection** (saves the best-eval round, not the noisy last) and
**two independent training seeds** (`--seed`), no-search over 150 disjoint held-out seeds:

| | baseline | + intent | Δ mean |
| --- | --- | --- | --- |
| **seed 1** | 41.7% | 46.8% | **+5.1** (intent better on every cell, strongest on hard 1.5×) |
| **seed 2** | 48.7% | 49.5% | +0.8 (a wash; intervals overlap on every cell) |

So fixing the selection noise **flipped the original "clean negative" into a small positive** — but it
is **inconsistent across seeds** (+5pt vs ~0). Decisively, the *baseline itself* swings 41.7 → 48.7
between seeds: **between-seed training variance (~7pt) is larger than the intent effect.** Net read:
concrete enemy intent gives at most a marginal, unreliable lift to the no-search policy. The dominant
factor is **training stability / variance**, not encoder information — consistent with the review
(the trainer is noisy; best-round selection already bought a bigger, more reliable gain).

## Decision

Keep `enemyIntent` **default-off**: the benefit is small and not seed-robust, and adopting it would
invalidate every checkpoint (obsSize change) for an uncertain ~+3pt. It stays an opt-in
(`createEncoder(..., { enemyIntent: true })`, `unified.ts --intent=1`) worth re-testing once the
trainer is more stable (bootstrapped value targets / belief-weighted determinization) — at which point
the seed variance should shrink and the true effect become measurable. The **`obsSize` guard** is kept
regardless — it closes a real silent-mis-encode hole.

**Lesson:** the *first* version of this experiment reached the opposite (wrong) conclusion purely from
last-round checkpoint noise. Best-round selection + multi-seed replication + Wilson CIs were each
necessary to get an honest read — and the honest read is "small, noisy, don't adopt yet."

Reproduce:
```sh
for s in 1 2; do
  npx tsx scripts/unified.ts --seed=$s --intent=0 --difficulties=1.0,1.5,2.0 --arcs=1,3 --out=.models/base_s$s.json
  npx tsx scripts/unified.ts --seed=$s --intent=1 --difficulties=1.0,1.5,2.0 --arcs=1,3 --out=.models/intent_s$s.json
done
# then compare no-search policyWinRate per class/difficulty over ≥150 DISJOINT seeds (Wilson CIs)
```
