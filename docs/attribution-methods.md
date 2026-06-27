# Better balance tooling: statistical attribution + value-head equity

One-at-a-time ablation is the causal gold standard but it's slow, binary, saturates at easy
difficulty, and misses interactions. These two tools address those weaknesses and *triangulate*
with ablation — agreement across all three is the real confidence signal.

## 1. Statistical attribution (`scripts/balance-attribution.ts`)

Run ONE large corpus of games, record which content each run had + whether it won, then fit a
**ridge logistic regression** of win on content presence (`src/search/attribution.ts`, IRLS with
coefficient standard errors). Output: every item's odds ratio + an approximate 95% CI, from a
single pass, controlling for the others and for difficulty. The game's own RNG randomizes what's
offered/granted, which makes the coefficients closer to causal than typical observational data.

**Honesty (1) — inference is approximate.** The SEs come from the *ridge-penalized* Hessian, so the
coefficients are shrunk and the z / CI are penalized-Wald: they understate uncertainty and bias odds
ratios toward 1. Use them to *rank* and *screen*, not as exact significance tests — confirm the
extremes causally (ablation / the grant-as-starter A/B).

**Honesty (2) — associational, not causal:** winning runs survive longer and draft
more, a survivorship tilt we don't fully remove (so all relics read OR ≥ 1; the *relative* ranking
and significance are the signal). Confirm extremes with ablation.

Greedy corpus, 2400 runs across `1.0/1.5/2.0 × 1/3-act`, win rate 43%:

| Strongest relics | OR (95% CI) | z |
| --- | --- | --- |
| **tempo-band** | **23.2** [14.3, 37.6] | 12.7 |
| cornered-instinct | 7.3 [4.9, 11.0] | 9.5 |
| moss-amulet | 4.3 | 6.7 |
| war-paint / whetstone | 3.2 / 3.1 | 7.3 / 5.4 |

| Weakest cards (traps) | OR (95% CI) | z |
| --- | --- | --- |
| **whirlwind** | **0.33** [0.23, 0.48] | −5.9 |
| toxic-cloud | 0.47 | −4.2 |
| cleave-the-horde | 0.58 | −3.4 |
| pommel-strike | 0.62 | −2.9 |

Under-tuned relics (OR ≈ 1, not significant): `iron-brand` (1.31), `bloodthirster` (1.23) — matching
the [whetstone deep-dive](whetstone-deep-dive.md). Potions all read OR ≈ 1 — the greedy corpus never
uses them (its blindspot); rerun with `--player=hybrid` for potion attribution.

## 2. Value-head equity screen (`scripts/balance-equity.ts`)

The net's value head `V(s) ≈ P(win)`. Score a card by the equity swing of adding one copy to the
deck across many sampled states: `ΔV = V(deck+card) − V(s)`. **No rollouts, no full episodes, no
survivorship** — and it's seconds to rank all 79 cards. A cheap pre-filter; reflects only what the
value head learned, so it screens (confirm extremes with ablation).

| Strongest by ΔV | | Weakest by ΔV | |
| --- | --- | --- | --- |
| troll-blood | +3.5% | **whirlwind** | **−5.5%** |
| venom-blade | +3.2% | rat-bite | −4.1% |
| flurry-of-knives | +2.9% | throwing-knife | −3.8% |

## Convergence (why this matters)

Independent methods agree on the extremes — that's the confidence we couldn't get from ablation alone:

| Item | Attribution | Equity screen | Ablation (earlier) |
| --- | --- | --- | --- |
| **whirlwind** | OR 0.33 (worst card) | −5.5% (worst) | — | → **trap, high confidence** |
| **troll-blood** | OR 2.43 (strong) | +3.5% (best) | — | → strong |
| **whetstone** | OR 3.06 | — | +4.7 @1.5× | → strong (fairly costed) |
| **iron-brand** | OR 1.31 (n.s.) | — | ≤0 @2.0× | → under-tuned |

## Confirmation: tempo-band IS overpowered (both tiers)

The attribution standout (`tempo-band`, OR 23) was confirmed with a clean grant-as-starter A/B
(`scripts/relic-ab.ts`): grant it to every run, compare win rate with it working vs. neutralized.
(Plain ablation is too weak here — only ~14% of runs hold it, so removing it barely moves the
aggregate.) Win-rate value *when held*:

| Difficulty | median (greedy) Δ | optimal (hybrid) Δ |
| --- | --- | --- |
| 1.5× | +54.3 (75% vs 21%) | +6.7 (100% vs 93%) ← *ceiling artifact* |
| 2.0× | +39.8 (45% vs 5%) | **+43.3 (98% vs 55%)** |

It looked playstyle-dependent at 1.5× (+6.7 for the optimal agent) — but that was the **93% ceiling
masking it** (same headroom lesson as the potions). At 2.0×, where the optimal agent has room, it
takes win rate **55% → 98%**. So `tempo-band` is **genuinely overpowered across skill tiers**, not a
greedy-spam artifact — a real nerf candidate. (Mechanism: +1 Block per card played is a defensive
engine that scales with cards/turn for everyone, and survival is the bottleneck at high difficulty.)
The attribution tool found this in one corpus; the A/B confirmed it causally. **Lesson reinforced:
measure at a difficulty with headroom for the tier you're testing.**

## Other leads to confirm

- **`whirlwind`** — 6 AoE for 2 energy is overcosted for the typical 1–2 enemy fight; flagged a
  **trap** by two methods. Strong buff (or cost cut) candidate.
- **`iron-brand` / `bulwark-charm`** — under-tuned (from here + the deep-dive); buff candidates.

## Reproduce

```sh
npx tsx scripts/balance-attribution.ts --runs=3000 --difficulties=1.0,1.5,2.0 --acts=1,3
npx tsx scripts/balance-equity.ts --ckpt=.models/unified_m38.json --states=1500
```
