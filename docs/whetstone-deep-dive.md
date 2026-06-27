# Deep-dive: Whetstone & the combat-start relics

Follow-up on the one balance lead that survived [confirmation](balance-report.md#0-confirmation-pass--what-survived-the-optimal-agent-at-high-run-counts):
**Whetstone** (+2 Strength at the start of every combat). Two analyses with the optimal agent
(hybrid PUCT @120 sims) at 2.0×, where there's headroom (baseline ≈ 63%).

## A. Is Whetstone over-costed? — graded sweep (120 runs)

Sweep the Strength it grants and watch the optimal agent's win rate (`scripts/whetstone-grade.ts`):

| Whetstone grants | win rate | step |
| --- | --- | --- |
| +0 Str (inert) | 58.3% | — |
| +1 Str | 60.0% | +1.7 |
| +2 Str (**live**) | 61.7% | +1.7 |
| +3 Str | 63.3% | +1.7 |

**A textbook-linear curve — +1.7 pts per point of Strength, no plateau.** Each point earns the same
marginal win rate, so the live **+2 is fairly costed, not "free power."** Nerfing to +1 would cost a
real ~1.7 pts; it isn't an over-tuned freebie. Bonus: Whetstone is a *clean linear tuning knob* — if
the design wants relics weaker/stronger overall, its Strength dials win rate predictably.

## B. How does it rank against its siblings? — combat-start relic ablation (100 runs, 2.0×)

Baseline 63.0%; Δ = win-rate drop when the relic is neutralized:

| Relic | grants | Δ @2.0× | Δ @1.5× |
| --- | --- | --- | --- |
| war-paint | +1 Str +1 Dex | **+5.0** | 0.0 |
| **whetstone** | +2 Str | **+4.0** | +4.7 |
| second-stomach | heal 6 | +1.0 | — |
| iron-brand | +1 Dex | 0.0 | — |
| bulwark-charm | +10 Block | −1.0 | — |

## Takeaways

- **Whetstone — strong but fair, not a nerf priority.** Consistently load-bearing across difficulties
  (+4.7 @1.5×, +4.0 @2.0×) and *linear* in cost (§A). Leave it unless relics are being toned down
  globally — in which case it's the cleanest knob to turn.
- **War-paint scales *up* with difficulty.** Neutral at 1.5× (0.0) but the **top** relic at 2.0×
  (+5.0): its Dexterity (block scaling) buys survivability that only matters once fights hit hard. A
  good example of a relic whose value is pressure-dependent — judge it at the difficulty it's meant for.
- **`iron-brand` (+1 Dex) and `bulwark-charm` (+10 Block) look under-tuned** — ≤0 contribution even at
  2.0× for skilled play. Buff candidates (or accept they're budget/early-game options).

Caveats: 100–120 runs, so 1 run ≈ 0.8–1.0 pt; the war-paint vs whetstone ordering at 2.0× is within a
run of noise, but both are clearly load-bearing (+4 to +5). All numbers are the *optimal* agent — the
intrinsic ceiling, not the median experience.

## Reproduce

```sh
npx tsx scripts/whetstone-grade.ts --runs=120 --difficulty=2.0 --ckpt=.models/unified.json
npx tsx scripts/balance-ablation.ts --kind=relics \
  --only=whetstone,iron-brand,war-paint,bulwark-charm,second-stomach \
  --runs=100 --difficulty=2.0 --ckpt=.models/unified.json --player=hybrid
```
