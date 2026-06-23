# RL and Search — Reference Document

**Audience:** A future engineer or AI agent building the RL system.
**Last updated:** 2026-06-16 (post-Milestone 9)

---

## 1. Purpose & Status

Two automated-agent tracks exist for this project:

| Track | Status | Entry point |
|---|---|---|
| (a) MCTS search bot | **SHIPPED — Milestone 9** | `src/search/mcts.ts` |
| (b) RL self-play / learned policy | **RESEARCHED, not built** | this document |

This doc is the canonical reference for both. It is grounded in the actual source code as of M9; read it together with the files it cites, not as a replacement for them.

---

## 2. Why This Game Is Ideal for Search / Planning

### The engine is a pure, deterministic reducer

`applyAction` in `src/engine/run.ts` takes `(ContentRegistry, RunState, GameAction) → RunState`. It is a pure function with no hidden state, no global mutations, and no I/O. Every random decision that could ever affect a run — draw-pile shuffle, enemy HP rolls, loot tables, event picks — derives from five independent mulberry32 sub-streams stored in `RunState.rng` (`src/engine/rng.ts`, type `RngStreams`):

```
StreamName = 'map' | 'combat' | 'loot' | 'events' | 'modifiers'
```

Each stream is a single `uint32` (type `RngState = number`). Serializing and deserializing `RunState` gives you exact byte-identical replay. This means:

- **Cloning a state for tree search costs one shallow object spread** — the engine already uses immutable value semantics throughout.
- **A saved state replays identically from any point** — useful for debugging, curriculum generation, and holdout-seed evaluation.

### Fully observable

`RunState` is completely transparent to any agent reading it. No cards are hidden from the agent (face-down mechanics do not exist in the current engine). `CombatState` exposes `drawPile`, `hand`, `discardPile`, `enemies` (each an `EnemyInstance` with `nextMoveIndex` set at combat start by `startCombat` in `src/engine/combat.ts`), and all status fields.

Combat is **near-perfect-information**: the draw-pile order is known in full until a reshuffle (which occurs in `drawCards` via `rng.shuffle` when the draw pile is exhausted), and each `EnemyInstance.nextMoveIndex` is visible, so the enemy's next move is always telegraphed. The only stochastic element visible during a turn is the shuffle that occurs on reshuffle — and since the `combat` RNG stream state is in `RunState`, even that is predictable by the agent.

### Cheap to step

The engine has no I/O, no async, and no GPU dependency. A full run completes in microseconds on a laptop CPU. The playtest harness (`scripts/playtest.ts`) sweeps thousands of full runs per second.

### Small, maskable discrete action space

The `GameAction` union (`src/engine/types.ts`, line 169) has **9 members**:

```
chooseNode | playCard | endTurn | pickRewardCard | skipReward
buyCard | leaveShop | rest | chooseEventOption
```

At any given state only a small subset is legal. `src/search/legalActions.ts` enumerates the exact legal set, mirroring the guards in `run.ts`. In practice the legal-action count per step is:

| Phase | Typical legal count |
|---|---|
| `map` | 1–2 (path choices) |
| `combat` | 2–10 (endTurn + playable cards × targets) |
| `reward` | 1–4 (skip + up to 3 picks) |
| `shop` | 1–4 (leaveShop + affordable items) |
| `rest` | 1 (forced) |
| `event` | 2–3 (option choices) |

Flat action-space size is approximately **45–50 discrete slots** when fully unrolled (hand index × target index for playCard, reward index, shop index, node id).

### Short episodes

The map (`src/engine/map.ts`) generates 5 or 6 "choice rows" (controlled by `tempoHint`), followed by a forced rest row and a boss row. Total nodes traversed per run: **7–8**. Each node involves a bounded number of steps (a combat typically 3–10 turns). Full runs complete in well under 1,000 engine steps.

### Clear terminal reward with easy dense shaping

Victory → `state.phase === 'victory'`. Defeat → `state.phase === 'defeat'`. Win/loss is unambiguous, and intermediate progress (map row, HP fraction) provides a natural dense signal.

---

## 3. What Shipped: The MCTS Bot (M9)

### Legal action enumeration — `src/search/legalActions.ts`

`legalActions(content, state)` returns `GameAction[]`. It switches on `state.phase` and mirrors every guard that `applyAction` enforces:

- **`map`**: returns one `chooseNode` per reachable next node.
- **`combat`**: always includes `endTurn`; iterates `combat.hand` and adds `playCard` actions for every card where `card.cost <= combat.energy`, expanding to one action per living enemy target if `card.target === 'enemy'`.
- **`reward`**: `skipReward` + one `pickRewardCard` per card in `state.reward.cards`.
- **`shop`**: `leaveShop` + one `buyCard` per affordable, unsold item.
- **`rest`**: always `[{ type: 'rest' }]` (no branching).
- **`event`**: one `chooseEventOption` per option in the event definition.
- **`victory` / `defeat`**: empty array (terminal).

### MCTS implementation — `src/search/mcts.ts`

The exported entry point is `mctsAction(content, state, opts)`. It runs UCT (Upper Confidence Bound applied to Trees):

**Node structure:**
```ts
interface Node {
  state: RunState;
  parent: Node | null;
  action: GameAction | null;
  children: Node[];
  untried: GameAction[];   // legalActions not yet expanded
  visits: number;
  total: number;           // cumulative value
  terminal: boolean;
}
```

**Loop** (`opts.iterations` times):

1. **Select** — descend via `bestChild` (UCT score = `total/visits + c*sqrt(log(parent.visits)/visits)`, tie-broken by `rand() * 1e-9`) until a node with untried actions or a terminal is reached.
2. **Expand** — randomly pick one untried action (using `opts.rand`), apply it via `applyAction`, add the resulting child.
3. **Simulate** — call `rollout()`, which runs `opts.rollout` (an injected `RolloutPolicy`) until terminal or `maxRolloutSteps` (default 4,000). In the playtest harness this is the greedy heuristic (`POLICIES.greedy`).
4. **Backpropagate** — walk the parent chain updating `visits` and `total`.

**Value function** (non-terminal states):
```ts
function value(state): number {
  if (state.phase === 'victory') return 1;
  const depth = currentRow / bossRow;
  const hpFrac = state.hp / state.maxHp;
  return Math.min(0.8, depth * 0.6 + hpFrac * 0.2);
}
```
Victory = 1.0; any non-terminal state is capped at 0.8, so a win always beats survival.

**Final action selection**: the child with the most visits (robust child), not the highest average — standard UCT practice.

**Injected `rand`**: all randomness for tree decisions passes through `opts.rand`, keeping the search reproducible and separate from the engine's RNG streams.

**Exploration constant**: defaults to `Math.SQRT2` (`opts.explore`).

### The CLAIRVOYANCE property

Because the full `RunState` (including `rng`) is cloned into each tree node, MCTS plans **against the actual seeded future**. Draw-pile order, upcoming enemy HP rolls, and loot table outcomes are all fixed by the seed at the root. The search does not face uncertainty about hidden information — it is a clairvoyant oracle.

**Implication**: MCTS win-rates are an **upper-bound skill ceiling / exploit probe**, not an estimate of human or fog-of-war agent performance. It is the correct tool for:
- Identifying broken card/relic combos (degenerate strategies the search finds instantly).
- Calibrating difficulty knobs (if MCTS wins 100%, the game is solved at that setting).
- NOT for simulating how a real player experiences the game.

**Determinized MCTS** (re-seeding the hidden RNG sub-streams per rollout) is a noted future option for fog-of-war evaluation, but is not implemented.

### Build exclusion

`tsconfig.build.json` excludes `src/search/**` via its `exclude` array. The search module is a dev/research tool; it does not ship in the npm package.

### Usage

```sh
npx tsx scripts/playtest.ts --policy=mcts --iters=150 --runs=60
```

Arguments:
- `--iters=N` — MCTS iterations per decision (default 200).
- `--runs=N` — number of full runs to sweep.
- `--enemyhp=F` — enemy HP multiplier (e.g. `2.0` for a harder difficulty; applied by `scaleContent` in the harness without touching shipped content).
- `--maxhp=N` — player starting and max HP (default 70).
- `--gold=N` — starting gold (default 50).
- `--seedbase=S` — seed prefix; run `i` uses `${seedbase}-${i}`.

Output is a single JSON object to stdout with `winRate`, per-death breakdowns, and `topCardPlays`.

### Results measured (M9)

| Policy | Win rate (60 runs, default difficulty) |
|---|---|
| MCTS (iters=150) | **100% (60/60)** |
| Greedy heuristic | ~96.5% |

At default difficulty (`maxHp=70`, `enemyHpMult=1.0`) MCTS achieves perfect win rate — the game is **effectively solved for optimal play** at this setting. This is the primary evidence backing the planned difficulty balance pass and difficulty-tier system.

**Caveat on `topCardPlays`**: the harness tallies raw play volume across all runs. Starter cards (`rusty-shortsword`, `battered-buckler`) dominate by deck share (9 copies in the starter deck vs. 0 copies of acquired cards at run start), not by being disproportionately chosen. To get a clean dominant-card signal, add pick-rate telemetry: track how often each card is chosen at reward screens relative to how often it appears as an option.

---

## 4. RL Feasibility & Recommendation (Researched, Not Built)

### RLHF is the wrong tool

This game has an objective win/loss signal. There is no human-preference alignment problem. RLHF (Reinforcement Learning from Human Feedback) is designed for problems where the reward is ambiguous and must be inferred from human comparisons. Do not apply it here. The right tools are search (MCTS, done) and/or learned-policy RL with ground-truth reward.

### "Self-play" is a misnomer

Enemies cycle moves in a fixed pattern (`endTurn` in `src/engine/combat.ts` advances `nextMoveIndex` modulo `def.moves.length`). There is no adversarial opponent learning a counter-strategy. The correct framing is:

**Iterated policy improvement + difficulty curriculum.**

The curriculum knobs already exist in the harness: `enemyHpMult`, `maxHp`, `startingGold`, `tempoHint`. A training loop adjusts these to keep the agent near its frontier.

### Recommended approach: AlphaZero-lite in-process in Node

Run everything in the existing TypeScript/Node process, using the existing engine directly. Do **not** port the engine to Python or build a per-step Node↔Python bridge.

**Why not Python/Gym/SB3:**
- The mulberry32 RNG streams must stay byte-identical for replay and debugging. Porting arithmetic to Python (especially floating-point edge cases in the mulberry32 implementation) is high-risk and difficult to verify.
- A per-step IPC bridge (stdin/stdout or socket) adds ~10–100µs per step. At thousands of steps per second this is a 10–100× throughput hit that kills search budgets.
- If Python is mandated by organizational requirements, batch at the **episode level** (actor/learner split, not per-step): Node actors run full episodes and send (state, action, reward) trajectories to a Python learner. Never cross the boundary per step.

**Why AlphaZero-lite over PPO/DQN:**
- Pure MCTS (done) already discovers optimal play. AlphaZero-lite adds a small policy+value MLP to amortize search: the policy head prunes bad branches (replaces uniform rollouts), the value head replaces the rollout entirely at leaf nodes.
- PPO and DQN learn a reactive policy without lookahead. They are strictly weaker for discovering optimal/degenerate play but PPO is the right choice later for distilling a fast shippable policy from MCTS visit distributions (supervised on MCTS outputs, or via DAgger).

### State encoding (approximate)

| Component | Encoding | Approx. floats |
|---|---|---|
| Deck (hand + draw + discard) | Count vector over 31 card ids, one per pile | 93 |
| Enemies | Count vector over 11 enemy ids, plus per-enemy HP/block/status scalars | ~55 |
| Relics | Binary vector over 8 relic ids | 8 |
| Player scalars | hp, maxHp, block, gold, energy, turn | 6 |
| Statuses (4 types × player + enemies) | Stack counts | ~20 |
| Map / phase | Current node kind (one-hot 7), row fraction, phase one-hot | ~15 |
| **Total** | | **~200 floats** |

The exact vocabulary sizes come from the closed unions in `src/engine/types.ts` (`StatusId` has 4 values; `NodeKind` has 7 values) and the content registries (31 cards, 11 enemies, 8 relics, 6 events in `src/engine/content/`).

### Action masking

`legalActions(content, state)` already enumerates the exact legal set. Map its output to the flat ~45-50 discrete slots and zero out illegal logits before softmax. This is correct-by-construction: the mask is derived from the same guards `applyAction` enforces.

### Reward design

```
R_terminal = +1  (victory)  /  0  (defeat)
R_shaping  = potential-based:  γ·Φ(s') − Φ(s)
Φ(s)  =  (currentRow / bossRow) * 0.6  +  (hp / maxHp) * 0.2
```

Potential-based shaping (Ng et al. 1999) guarantees that the optimal policy of the shaped MDP is the same as the original — no distortion. The `value()` function in `src/search/mcts.ts` already implements this potential. Do not add non-potential shaping terms (e.g., raw `+0.1` per kill) without proving they don't change the optimal policy.

For balance/exploit probing, add a secondary objective: win rate at elevated `enemyHpMult` (e.g., 1.5×, 2.0×). Track this in the eval harness alongside the primary reward.

### Compute profile

- **CPU-bound, not GPU-bound.** The engine is pure arithmetic; the MLP (if built) is tiny (2–3 layers, ~64–128 hidden units).
- **Pure MCTS**: laptop CPU, no GPU needed.
- **AlphaZero-lite**: spend on cores (16–32), not GPU. `worker_threads` in Node parallelizes actors perfectly — each worker gets a copy of the content registry and runs independent episodes. No shared mutable state between actors.
- **One consumer GPU** (RTX 4070-class) helps with net inference/training batch. A 4090 or 5090 would be underutilized at this content size. Multi-GPU is almost certainly unjustified.
- **The real bottleneck is engine-step throughput and avoiding IPC**, not GPU FLOPs.

---

## 5. Phased Roadmap

### Phase 0 — Pure MCTS (DONE, M9)

- `src/search/legalActions.ts` + `src/search/mcts.ts`
- Eval harness: `scripts/playtest.ts`
- Result: 100% win rate at default difficulty; game effectively solved.
- Gate to Phase 1: desire for a faster per-decision agent OR latency bottleneck in large difficulty sweeps.

### Phase 1 — AlphaZero-lite

**Build list and rough effort:**

| Component | File / location | Effort |
|---|---|---|
| State encoder | `src/search/encode.ts` — vectorize `RunState` to `Float32Array` using the closed vocabularies | 1–2 days |
| Action masker | Thin wrapper on `legalActions()` mapping to flat index | 0.5 days |
| Policy + value MLP | `src/search/net.ts` — small ONNX Runtime or hand-rolled net in Node | 2–3 days |
| Self-play / training loop | `scripts/train.ts` — MCTS actors (worker_threads) feed replay buffer; learner updates net | 3–5 days |
| Parallel actor runner | `worker_threads` pool; each worker runs `createRun` → episode loop → post trajectory | 1–2 days |
| Eval integration | Extend `scripts/playtest.ts` with `--policy=alphazero`; reuse existing metrics | 0.5 days |
| Exploit reporter | Log win rate at swept `enemyHpMult` values per eval checkpoint | 1 day |

**Total Phase 1 estimate: ~2 weeks for a first working loop.**

The existing `mctsAction` in `src/search/mcts.ts` already accepts an injected `RolloutPolicy`. Replace the greedy rollout with a value-head prediction and pass policy logits as prior probabilities in PUCT — no changes required to the engine or the harness structure.

### Phase 2 — Distill to shippable policy

- Supervised: train a no-search net on MCTS visit distributions (`n(a) / sum(n)` as soft targets).
- Or PPO: run policy gradient with MCTS-generated advantages.
- Goal: a fast inference-only agent (< 1ms per decision) suitable for shipping as an "AI opponent" or difficulty advisor in the live game.

---

## 6. Risks

### Over-engineering (the Python/bridge trap)

The biggest risk is building a Python/Gym/StableBaselines3 stack before verifying that the Node-native approach is insufficient. The engine is already fast and pure. Start in Node; reach for Python only if a specific library dependency justifies it, and only batch at the episode level.

### RNG byte-identical porting risk

The mulberry32 implementation in `src/engine/rng.ts` uses `Math.imul` and `>>> 0` for unsigned 32-bit arithmetic specific to JavaScript. Any port to Python must replicate these semantics exactly (Python integers are arbitrary-precision by default; `ctypes.c_uint32` or NumPy `uint32` are needed). A mismatch breaks replay and makes cross-language debugging extremely difficult. **Do not port unless forced; if forced, write a byte-level round-trip test before doing anything else.**

### Chance-node handling in MCTS

Two stochastic events occur during a run that the current MCTS treats as deterministic (because it reads them from `RunState`):

1. **Draw pile reshuffles**: when the draw pile empties, `drawCards` in `src/engine/combat.ts` shuffles the discard pile using the `combat` RNG stream. In the MCTS tree this is a deterministic branch because the stream state is in the cloned node.
2. **Loot / enemy rolls**: rolled at node entry via the `loot` and `combat` streams, also captured in `RunState`.

For a determinized MCTS (fog-of-war mode), you would re-seed these streams at rollout start with a fresh random seed. This would yield a proper expectation over shuffles rather than planning against the actual draw order. This is not implemented and should be added before using MCTS to estimate **player** win rates (as opposed to clairvoyant upper bounds).

### Reward shaping artifacts

Non-potential-based shaping can create spurious optimal policies. For example, a raw `+0.05` per enemy kill might encourage stalling. Always use the potential-based form `γ·Φ(s') − Φ(s)`. The existing `value()` function in `src/search/mcts.ts` is already structured this way (it is an estimate of the terminal potential, not an additive bonus).

### Seed overfitting

If training always uses the same seed range, the learned policy may exploit patterns in those specific seeds (e.g., the map structure generated by `play-0` through `play-499`). Mitigation: hold out a disjoint seed range for evaluation (e.g., `eval-0` through `eval-99`), never seen during training. Additionally, **do not feed the raw RNG stream state** (`RunState.rng`) into the observation vector — it would give the net direct access to all future randomness, collapsing the exploration problem. The state encoder should include only semantically meaningful fields (HP, deck, enemy state, etc.).
