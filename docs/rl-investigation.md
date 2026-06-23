# RL Investigation — Learning to Play Claude Code Crawler

**Workspace:** `autoClaudeCodeCrawler` is a writable mirror of the `claudeCodeCrawler`
game engine (re-mirrored to **Milestone 13**), where we build an RL agent that plays
the game. The engine is treated as read-only upstream; all RL code lives in
`src/search/` and `scripts/`. (deepPairing MCP is pinned via `.mcp.json`.)

**TL;DR.** A learned, net-guided search agent **matches pure MCTS** on the live game:
100% at base difficulty (with fewer simulations), ~75–80% at 1.5× (≈ MCTS), and ~45%
at 2.0× (vs clairvoyant MCTS 55%). The headline lesson is methodological: nearly every
confident "ceiling" we hit turned out to be a measurement or target artifact, not a
property of the game.

---

## 1. What the game demands

`applyAction(content, state, action)` is a pure, deterministic reducer; all randomness
lives in `RunState.rng` (mulberry32 streams). This makes the game:
- **Fully observable** for an agent that reads `RunState` — except we deliberately
  **exclude the RNG** from the observation, so the *future* (draws, rolls, loot) is hidden.
- **Cloneable/replayable** byte-identically → search can plan against a determinization.
- A **long-horizon planning problem**: ~7–8 nodes, hundreds of decisions, a single
  terminal win/loss reward. The pivotal choices (pathing, deckbuilding, when to rest)
  pay off far in the future → **lookahead matters**, which is why search dominates a
  reactive policy.

## 2. Components built (`src/search/`)

| Module | Role |
|---|---|
| `encode.ts` | State → fixed `Float32Array` (300 on M13). Vocab from the content registry; closed unions (status/node/phase) hardcoded but **fingerprinted** (see vocab). `RunState.rng` excluded (no future-leak). Optional positional-hand block. |
| `mask.ts` | Flat 73-slot action space over `legalActions()`; overflow surfaced, never silently dropped. |
| `vocab.ts` | **Append-only** id→index manifest + FNV-1a fingerprint. Fingerprint now includes the closed-union sizes (status/node/phase) — closes a silent-drift hole. |
| `checkpoint.ts` | Bundles `{fingerprint, manifest, model}`; `assertCompatible` rejects incompatible/structurally-drifted checkpoints. |
| `net.ts` | MLP (forward + hand-derived backprop + `trainStep`), gradient-checked. |
| `entityNet.ts` | Attention-pooling net over learned entity embeddings, **hand-derived backprop validated by a finite-difference gradient check**. |
| `mcts.ts` (upstream) | Clairvoyant UCT, greedy rollouts. The reference search. |
| `puct.ts` | Net-guided MCTS; `leafRollout` (hybrid) and `priorMix` (prior dampening) options. |
| `ismcts.ts` | Information-Set MCTS — re-determinizes the hidden future each iteration → a **learnable** fog-of-war expert. |
| `azsearch.ts` | Net-guided **determinized** PUCT — the engine for learnable AlphaZero self-play. |
| `determinized.ts` | `qDeterminized` / `buildQTargets` — expected-win targets over re-seeded futures (learnable). |
| `pretrain.ts`, `distill.ts`, `train.ts`, `heuristic.ts`, `policy.ts`, `eval.ts` | Behavioral cloning, distillation, self-play loop, greedy heuristic + rollout, no-search policy, imitation-agreement metric. |

Runners in `scripts/`: `cloneGreedy`, `dagger`, `daggerIsmcts`, `unified`, `selfplay`,
`hybrid`, `evalckpt`, `qbuffer`, `abArch`, `abSweep`, `playtest`, `mirror-engine.sh`.
A Python actor/learner scaffold lives in `learner/` (episode-level split; not required —
the whole stack runs in Node, the models are ~10k–300k params, CPU-trivial).

## 3. The investigation (hypotheses → evidence)

Each step tested a hypothesis; most were **refuted** by a controlled experiment.

1. **Pure MCTS is strong.** Confirmed — 100% at base ("effectively solved").
2. **A learned value head can replace rollouts (AlphaZero-lite).** Partly: net-PUCT
   capped ~85% — the **value-at-leaf** was the limiter. Pure rollouts beat it.
3. **Positional-hand encoding helps the no-search policy.** *Refuted* by a controlled
   A/B (identical imitation agreement). The win was noise.
4. **A bigger/attention net helps.** Multi-seed sweep showed a modest, high-variance
   edge — but both nets were weak (~10–30%) because of the *targets*, not architecture.
5. **A ~30% no-search ceiling is fundamental.** *Refuted.* It was: (a) **unlearnable
   targets** — cloning clairvoyant MCTS, whose action depends on the hidden future;
   (b) **distribution shift** — offline training on the expert's states cascades when
   the net plays its own; (c) a **silent encoding bug** — `poison`/`dexterity` statuses
   were dropped on the real game; (d) **too-few eval seeds**.
6. **Determinized-Q targets fix learnability.** Yes for value (no collapse), but the
   *offline* policy still cascaded (distribution shift). → **DAgger** (train on the
   net's own states) was the fix.
7. **Clone a deterministic, learnable expert (greedy).** Worked dramatically: DAgger-greedy
   reached **70% no-search — beating the 60% greedy heuristic** (the net denoises greedy's
   stochastic pathing).
8. **Hybrid PUCT** (net priors + rollout leaf value) → **100% at base with 160 sims**
   (beats pure MCTS on efficiency). Value-at-leaf was indeed the cap.
9. **Hard difficulty needs a hard-competent, learnable expert.** Greedy is weak at hard;
   clairvoyant MCTS is unlearnable. **ISMCTS** (determinized) is both strong and learnable
   (greedy 8% vs ISMCTS 67% at 1.5×). Cloning it gave good hard **priors** → hybrid 63%→83%.
   (Its *standalone* policy stays weak — expert *consistency* matters for cloning, and
   stochastic search makes noisy one-hot labels.)
10. **One unified net across difficulties.** `unified.ts` (greedy@base + ISMCTS@hard) →
    100% base / 77% hard hybrid in one model.
11. **Full AlphaZero self-play.** `selfplay.ts` + `azsearch.ts`: net-guided *determinized*
    search → learnable targets, warm-started → **self-improves with no external expert and
    no collapse** (the failure mode that broke earlier attempts). Holds/slightly improves
    over rounds; big gains need many more rounds.
12. **"We don't match pure MCTS at hard."** *Refuted (my measurement error).* The "85%
    MCTS" came from a *different* difficulty mechanism (`scaleContent`) + seeds + sims.
    Like-for-like (`config.enemyHpMult`, same seeds, 400 sims): MCTS 80% vs our 75–77% at
    1.5× — **within noise**. We already match.

## 4. Final results (M13, `config.enemyHpMult`, `eval` seeds)

| difficulty | unified net + hybrid | pure MCTS | notes |
|---|---|---|---|
| **1.0× (base)** | **100%** (@160 sims) | 100% (@400) | matched; we win on efficiency |
| **1.5× (hard)** | **75–77%** (@400) | 80% (@400) | within 40-seed noise — matched |
| **2.0× (brutal)** | **~45%** (@800) | 55% (@400) | fog-of-war gap; 2.0× *is* winnable |
| no-search policy | 70% base / ~10% hard | — | beats the 60% heuristic at base |

The learned net's real job is to **guide search**, not to play alone — measured by that
yardstick it matches the clairvoyant reference and is more sim-efficient.

## 5. Methodology lessons (the durable takeaways)

- **Learnable targets only.** Don't clone a *clairvoyant* expert — its decision depends on
  hidden info the net can't see. Determinize (ISMCTS / `qDeterminized`) or use on-policy outcomes.
- **On-policy data (DAgger).** Offline imitation cascades off-distribution; train on the
  states the agent actually visits.
- **Expert consistency** drives behavioral cloning — a deterministic heuristic clones far
  better than a strong-but-stochastic search.
- **Hybrid search**: net priors for efficiency + rollout leaf value for quality. Add
  **prior dampening** so weak priors can't underperform pure MCTS.
- **Audit encoder/content alignment** on every game update — a hardcoded closed union
  (statuses) silently dropped real mechanics. The fingerprint now guards this.
- **Measure honestly:** fix *one* difficulty mechanism + seed set + sim budget before
  quoting a "ceiling," and use enough seeds (40+ for win rate; per-state agreement for
  lower variance). Several "ceilings" here were artifacts.
- **The model is tiny (~10k–300k params), CPU-trivial.** GPU/Python is a convenience
  (autodiff, bigger nets), not a requirement; the bottleneck is self-play *throughput*.

## 6. Open frontier

- **2.0×**: real headroom remains (45% vs MCTS 55%). More self-play rounds, heavier search,
  or a stronger determinized expert at 2.0× could close it; some gap is irreducible
  fog-of-war (clairvoyance) disadvantage.
- **Scale the self-play flywheel** (thousands of rounds) for genuine super-heuristic gains.
- **Attention net + Python/GPU** if the content grows enough to need more capacity.
