# Value-head calibration: the value head is collapsed, and it's architectural

Goal: "value-target debiasing" — the methodology review argued the determinized value *targets* are
strategy-fusion overconfident. We built a diagnostic to verify that, and the verification took us
somewhere deeper and more decisive than expected.

## The diagnostic (`scripts/value-calibration.ts`, `src/search/calibration.ts`)

For sampled states, compare the value head's predicted win probability `V(s)` against the **realized**
greedy win probability (honest Monte-Carlo over re-seeded futures). Output: a reliability diagram +
expected calibration error (ECE) + net over/under-confidence. (Pure addition; tested.)

## What we found: the value head doesn't discriminate at all

On a trained checkpoint, sampling across difficulties:

| states | mean predicted V | mean realized greedy win |
| --- | --- | --- |
| **1.0× only** | ~49% | **82%** (underconfident −33) |
| **2.0× only** | ~50% | **8%** (overconfident +42) |

**The value head predicts ~50% at *both* easy and brutal**, while reality spans 82% → 8%. It is a
near-constant — it carries essentially no information about how winnable a state is. (This also
explains why the Batch B *leaf-value blend* didn't help: blending a constant-50% signal into the PUCT
leaf is noise, not value.)

## Three principled fixes — each verified, none sufficient

We chased it methodically; **each step fixed a real, verified gap, and none fixed the collapse:**

1. **Honest value targets** — the hard-difficulty target was `ismctsSearch.rootValue` ≈ 0.50 when
   greedy reality is ≈ 0.08 (a **+42pt strategy-fusion overconfidence**, the original hypothesis,
   confirmed). Replaced it with `qDeterminized` (unbiased MC) at all difficulties. → value head still
   ~constant.
2. **Absolute-threat encoding** — the encoder stored only `hp/maxHp` *fractions*, so a 1× enemy
   (21 HP) and a 2× enemy (42 HP) at full health produced a **byte-identical vector** (L1 diff
   0.0000, 0/1249 dims) — the net was *provably blind to difficulty*. Added absolute `maxHp`. → value
   head still ~constant (predicts ~63% at both).
3. **Value-loss weighting** (`trainStep` `valueCoef`) — `trainStep` weighted value MSE and policy CE
   equally; in the shared-trunk MLP the policy gradient dominates the hidden layer. Up-weighted the
   value gradient (`valueCoef=5`). → value head **still** ~constant (predicts ~48.5% at both).

## Conclusion: the collapse is architectural

Honest targets + a difficulty-visible encoder + value-loss weighting were each *necessary* and
*correct*, but the value head **still** won't separate easy from brutal. The remaining cause is the
**shared-trunk architecture**: the hidden layer is shaped by the policy cross-entropy (a large,
multi-action gradient), and a single linear value head reading those policy-features can't recover
winnability — even when up-weighted. The fix is a **separate value network** (its own trunk), not a
target/encoder/weighting tweak.

Pragmatically, this is *why the agent still works*: hybrid PUCT uses a **greedy rollout** for the leaf
value, not the value head — so the strong results (100% base, etc.) never depended on the collapsed
value head. A useful value head would let search go deeper with fewer sims, but it's a net-new
component, not a debias.

## What this PR merges (and what it doesn't)

- **Merges:** the calibration diagnostic (`calibration.ts` + tests + `scripts/value-calibration.ts`)
  and the `trainStep` `valueCoef` primitive (default 1 = byte-identical) — the reusable assets for the
  next step.
- **Does NOT merge:** the three experimental recipe changes (honest-targets-as-default, unconditional
  absolute-threat encoding, `valueCoef=5`). They're correct but checkpoint-breaking and don't pay off
  on their own; they belong with the **separate-value-head** work, where they'll actually be exercised
  and validated. (The honest-targets and absolute-threat findings are documented above so that work
  starts from them.)

Reproduce the diagnostic:
```sh
npx tsx scripts/value-calibration.ts --ckpt=.models/unified.json --states=400 --reseeds=20 \
  --difficulties=1.0 --acts=1   # then again with --difficulties=2.0 to see the non-discrimination
```
