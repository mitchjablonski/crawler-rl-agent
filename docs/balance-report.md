# M38 Balance Report (agent-driven)

Generated with the balancing toolkit (`scripts/balance-{grid,telemetry,ablation}.ts`) against the
M38 content and the `unified.json` checkpoint. These are **leads, not verdicts** — sample sizes are
modest and the optimal agent measures *intrinsic* balance, not the median-player experience. Reproduce
any row with the command in its section.

## Method

Three reference "players" span a skill ladder, and the spread between them is *suggestive* of
luck-vs-skill — but read the "median" tier with care (see the caveat):

| Tier | Policy | Reads as |
| --- | --- | --- |
| **optimal** | hybrid PUCT @160 sims | the skill ceiling / intrinsic difficulty |
| **median** | greedy heuristic | a fast baseline — but **capability-limited**, not a graded human |
| **casual** | no-search policy net | a fast/careless player |

> **Caveat on the "median" tier:** the greedy heuristic never uses potions, upgrades cards, or shops
> for potions — whole subsystems are *disabled*, not merely played worse. So an optimal-vs-greedy
> spread mixes a *capability* gap with a *skill* gap, and any conclusion touching potions/upgrades/
> shops is a greedy blindspot, not "the median experience." Where a finding leans on the greedy tier,
> it's flagged. For skill-graded reads, prefer hybrid-at-low-sims over greedy.

Ablation neutralizes one item (effects stripped, kept in the pool so draw order is preserved; cards
keep their cost so they're comparable to relics/potions) and re-measures win rate; the delta is its
contribution.

## 0. Confirmation pass — what survived the optimal agent at high run counts

The initial sweep below ran on the **median (greedy)** player. Re-running the top leads with the
**optimal agent (hybrid PUCT)** at high run counts (150 runs @1.5×; pocket-dice also 120 runs @2.0×)
is the headline result: **most single-tier leads were tier-specific, and only one replicated.**

| Lead | Greedy (median) | Optimal (high-run) | Verdict |
| --- | --- | --- | --- |
| **whetstone** (relic) | +3.3 | **+4.7** | ✅ **confirmed under the optimal agent** (+4.7 @1.5×) |
| pocket-dice (relic) | −5.8 (trap) | **0.0** @2.0× | median-only **skill trap**, not an intrinsic flaw |
| war-paint (relic) | +2.5 | 0.0 | median-only |
| weakening-jab (card) | +5.0 | +0.7 | median **crutch**, fine for skilled play |
| brace / caltrops (card) | +3.3 / −3.3 | +1.3 / −0.7 | noise |

Takeaways: **`whetstone` is the one durable balance lead** (a real nerf candidate — confirm direction
before acting). **`pocket-dice` is a noob-trap**, not a balance bug: it punishes unskilled play but the
optimal agent neutralizes its downside — a *design* signal, not a number to change. And the value of
multi-tier + confirmation is proven: 4 of 5 single-tier leads did not generalize.

(Note: at 1.5× the optimal baseline is 92.7%, so +Δ is capped at ~7 pts of headroom; whetstone's +4.7
≈ 7 runs is a solid signal, the sub-2-pt rows are within noise.)

→ Followed up in **[whetstone-deep-dive.md](whetstone-deep-dive.md)**: a graded sweep shows Whetstone
is *fairly costed* (linear +1.7 pts/Strength, not a freebie), and a sibling ablation finds `war-paint`
scales up with difficulty while `iron-brand`/`bulwark-charm` look under-tuned.

## 1. Difficulty & skill ladder

Win rate (hybrid @160 vs greedy), 20–30 seeds:

| Difficulty | optimal — 1 act | optimal — 3 act | median — 1 act | median — 3 act |
| --- | --- | --- | --- | --- |
| Base (1.0×) | 100% | 100% | 80% | 75% |
| Hard (1.5×) | 90% | 100% | 25% | 65% |
| Brutal (2.0×) | 55% | 95% | 20% | 45% |

Read: skill is clearly rewarded at ≥1.5× (optimal ≫ median) — the game is not luck-dominated there.
Base single-act is **saturated for the optimal agent (100%)**, which matters for ablation (below).
The 3-act arc is consistently *easier* than single-act at the same difficulty — more rests/shops/relics
to recover with.

## 2. Difficulty spikes — enemy lethality

Average player HP lost per combat step an enemy is on the field (greedy, 300 runs; large samples):

| Enemy | hp/step | sample |
| --- | --- | --- |
| **the-scope-creep** | **1.24** | 7952 |
| merge-conflict | 0.80 | 4968 |
| kernel-panic | 0.62 | 793 |
| mimic-crate | 0.55 | 3029 |
| lint-goblin | 0.44 | 4687 |

**`the-scope-creep` is the clear outlier** — ~1.5× the next enemy and ~3× the pack average, consistent
across both tiers (1.24 greedy / 1.30 optimal; enemy threat isn't a greedy blindspot, so the agreement
holds here). Prime candidate to tune down or telegraph more clearly.

## 3. Relic balance (ablation, greedy @1.0×, baseline 73.3%, 120 runs)

| Relic | Δ win when neutralized | Read |
| --- | --- | --- |
| **pocket-dice** | **−5.8 pts** | **trap** — the player wins *more* without it |
| whetstone | +3.3 | mildly load-bearing |
| war-paint | +2.5 | mildly load-bearing |
| moss-amulet / second-stomach / tempo-band | +1.7 | minor |
| (15 others) | ~0 | neutral for greedy play |

**`pocket-dice` is the standout *median-player* finding** (≈7 runs): holding it *lowers* greedy's win
rate. **But it did not replicate under the optimal agent** (0.0Δ @2.0×, 120 runs — see §0): it's a
**skill trap**, not an intrinsic balance bug. `whetstone` is the lead that survived confirmation.

## 4. Card balance (ablation, greedy @1.0×, baseline 78.3%, 60 runs)

> These deltas were measured with the *older* card-nerf (effects stripped **and** cost spiked to 99,
> which adds a "brick clogs the deck" confound). The nerf is now symmetric with relics/potions (cost
> kept), so a re-run would shift these slightly — another reason to treat the sub-2-pt rows as noise.
> No multiple-comparisons correction was applied across the card set; only large effects are signal.

Noise floor here is ~±2–3 pts (1 run ≈ 1.7 pts), so treat only the extremes as signal:

- **`weakening-jab` +5.0** — most load-bearing card for greedy (a debuff it leans on). *Did not
  replicate under the optimal agent (+0.7 @1.5×, 150 runs — §0): a median crutch, not over-tuned.*
- `brace / goblin-stomp / rupture / second-wind / throwing-knife / twin-jab / viral-load` +3.3.
- **`caltrops` −3.3** — mild trap for greedy play; several others at −1.7.

(Card ablation under greedy reflects the *median* player, which drafts somewhat blindly — re-run with
`--player=hybrid` on a narrowed list for skilled-play fidelity.)

## 5. Potions

Under **optimal** play the agent does use potions (fire-flask, surge-draught, might-elixir, venom-vial,
firebomb-flask) — confirming the M38 retarget wired them in correctly. Ablation at base difficulty was
**uninformative**: the optimal baseline is 100%, so there's no headroom and every potion reads 0.0Δ
(a ceiling effect). **Lesson: ablate at a difficulty with headroom (≥1.5×), not a saturated baseline.**

Re-run at **1.5× (baseline 93.3%, 30 runs)** — now there's headroom and the numbers move, though at
30 runs each ±3.3 pts is a single run (noise-floor; treat as illustrative):

| Potion | Δ win when neutralized |
| --- | --- |
| healing-draught | −3.3 (reads as a mild trap — the agent wins slightly more without it) |
| firebomb-flask / surge-draught | +3.3 (mildly load-bearing) |
| fire-flask / iron-tonic / might-elixir / venom-vial / insight-brew | ~0 |

The contrast with the saturated base run (all 0.0Δ) is the real takeaway: **pick an evaluation
difficulty where the player can actually lose**, then widen runs before drawing conclusions.

## Caveats / known measurement gaps

- **Greedy blindspots:** the greedy player never uses potions, upgrades cards, or buys potions, so its
  "dead content" lists include all `-plus` (upgrade-target) cards and all potions. That's policy, not
  balance.
- **Nobody upgrades — including the optimal agent.** All `-plus` cards are dead even under hybrid play.
  Upgrades are only reachable via `upgradeCard` at rests, and the agent never takes them. This is most
  likely an **agent-exploration gap** (the greedy rollout that values leaves doesn't upgrade), not proof
  upgrades are weak — re-confirm by training with an upgrade incentive before concluding anything.
- **Small hybrid samples** (20–30 runs) and **ablation noise** (~±2–3 pts at 60 runs): the named
  extremes are leads; widen runs before acting.

## Reproduce

```sh
npx tsx scripts/balance-grid.ts      --difficulties=1.0,1.5,2.0 --acts=1,3 --runs=30 --ckpt=.models/unified.json
npx tsx scripts/balance-telemetry.ts --runs=300 --difficulties=1.0,1.5 --acts=1,3
npx tsx scripts/balance-ablation.ts  --kind=relics  --runs=120 --difficulty=1.0
npx tsx scripts/balance-ablation.ts  --kind=cards   --runs=60  --difficulty=1.0
npx tsx scripts/balance-ablation.ts  --kind=potions --runs=30  --difficulty=1.5 --ckpt=.models/unified.json --player=hybrid
```
