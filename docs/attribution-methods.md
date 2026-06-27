# Better balance tooling: statistical attribution + value-head equity

One-at-a-time ablation is the causal gold standard but it's slow, binary, saturates at easy
difficulty, and misses interactions. These two tools address those weaknesses and *triangulate*
with ablation — agreement across all three is the real confidence signal.

## 1. Statistical attribution (`scripts/balance-attribution.ts`)

Run ONE large corpus of games, record which content each run had + whether it won, then fit a
**ridge logistic regression** of win on content presence (`src/search/attribution.ts`, IRLS with
coefficient standard errors). Output: every item's odds ratio + 95% CI + significance, from a
single pass, controlling for the others and for difficulty. The game's own RNG randomizes what's
offered/granted, which makes the coefficients closer to causal than typical observational data.

**Honesty:** associational *with controls*, not pure causal — winning runs survive longer and draft
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

## New leads to confirm

- **`tempo-band` (OR 23)** — "gain 1 Block per card played". The greedy corpus *spams* cheap cards,
  so this scales absurdly; almost certainly **playstyle-dependent**. Confirm with a hybrid-agent
  ablation — if it stays huge, it's a scaling-block outlier worth a hard look.
- **`whirlwind`** — 6 AoE for 2 energy is overcosted for the typical 1–2 enemy fight; flagged a
  **trap** by two methods. Strong buff (or cost cut) candidate.
- **`iron-brand` / `bulwark-charm`** — under-tuned (from here + the deep-dive); buff candidates.

## Reproduce

```sh
npx tsx scripts/balance-attribution.ts --runs=3000 --difficulties=1.0,1.5,2.0 --acts=1,3
npx tsx scripts/balance-equity.ts --ckpt=.models/unified_m38.json --states=1500
```
