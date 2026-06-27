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

## Result: no lift — evidence against the information hypothesis

Richer combat info did **not** raise the no-search ceiling. Knight is a wash (intervals overlap);
apothecary is *lower* with intent — though that cell is confounded (the intent arm's final DAgger
round drew a bad apothecary net, 47% in the training log). Net read: **adding decision-relevant input
features did not help the single-forward-pass policy**, which points the no-search ceiling at
**target quality + DAgger instability**, not encoder information — consistent with the rest of the
review (determinized targets are biased; the trainer's round-to-round variance is large).

**Caveat (don't over-read this):** single training draw per arm with an unstable trainer (DAgger loss
*climbs* across rounds here), so this is suggestive, not conclusive. A clean test needs N seeds per
arm and best-round (not last-round) selection. The point estimate could also be dragged by the larger
input adding variance to an already-noisy fit.

## Decision

Keep `enemyIntent` **default-off** (no demonstrated benefit, +20 features of variance/cost). It stays
available as an opt-in (`createEncoder(..., { enemyIntent: true })`, `unified.ts --intent=1`) for a
re-test once the trainer is more stable (e.g. with bootstrapped value targets / belief-weighted
determinization). The **`obsSize` guard** is kept regardless — it closes a real silent-mis-encode hole
(an old net's input width would otherwise mis-align against a wider vector with no error).

Reproduce:
```sh
npx tsx scripts/unified.ts --intent=0 --difficulties=1.0,1.5,2.0 --arcs=1,3 --out=.models/uni_base.json
npx tsx scripts/unified.ts --intent=1 --difficulties=1.0,1.5,2.0 --arcs=1,3 --out=.models/uni_intent.json
# then compare no-search policyWinRate per class/difficulty over ≥120 seeds (Wilson CIs)
```
