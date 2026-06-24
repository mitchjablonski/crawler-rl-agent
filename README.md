# Claude Code Crawler — RL Agent

A reinforcement-learning / search agent that learns to play
[Claude Code Crawler](https://github.com/mitchjablonski/claude-code-crawler) — a roguelike
deckbuilder — and **matches pure MCTS** on the live game while being more
simulation-efficient. Built and validated entirely in Node (TypeScript); the models are
tiny (~10k–300k params), so no GPU is required.

> The game engine in `src/engine/` is mirrored from the upstream game (MIT). All RL work
> lives in `src/search/` and `scripts/`. See [`docs/rl-investigation.md`](docs/rl-investigation.md)
> for the full writeup and [`docs/rl-investigation.html`](docs/rl-investigation.html) for a
> visual explainer. A self-contained replay of the agent playing is in
> [`docs/demo.html`](docs/demo.html).

## Results (M13 content, like-for-like: same difficulty mechanism, seeds, sim budget)

| Difficulty | Learned agent (net + hybrid PUCT) | Pure MCTS |
| --- | --- | --- |
| Base (1.0×) | **100%** (@160 sims) | 100% (@400) |
| Hard (1.5×) | **~80%** | 80% — matched |
| Brutal (2.0×) | **~45%** (@800) | 55% — fog-of-war gap |
| No-search policy (base) | 70% | (greedy heuristic 60%) |

Base is matched *and* won on efficiency. 1.5× is matched within noise. 2.0× is the genuine
frontier (some gap is the irreducible disadvantage of not seeing the future).

### Multi-arc (acts) × difficulty

The agent is trained and evaluated across the full **difficulty × arc** grid, not just single-act
runs. The encoder carries an explicit **act one-hot** (a categorical "which arc" tier that the
continuous global `rowFrac` can't separate — deeper acts draw harder enemy pools), and `unified.ts`
DAggers across `--arcs=1,3` while `hybrid.ts` evaluates a `--difficulties × --acts` grid. A single
unified net (hybrid PUCT @160 sims, 20 seeds):

| Difficulty | Single act (1) | Full arc (3 acts) |
| --- | --- | --- |
| Base (1.0×) | **100%** | **100%** |
| Hard (1.5×) | **80%** | **100%** |
| Brutal (2.0×) | 35%¹ | 70%¹ |

Multi-act is *not* harder for the searching agent — the longer arc has more rests/shops/relics to
recover with, so hybrid PUCT clears the 3-act hard run consistently, and the 3-act *brutal* run at
**70%** vs single-act's 35%. ¹The 2.0× row is the net trained on the full `1.0,1.5,2.0 × 1,3` grid
but evaluated at only 160 sims. At 2× the **sim budget dominates, not net training** — hybrid's leaf
value comes from greedy rollouts, so a 2×-trained net scores the same 35%/70% at 160 sims as an
out-of-distribution one; pushing single-act 2.0× to ≈45% takes ~800 sims (see the table above).
(Reproduce:
`npx tsx scripts/unified.ts --arcs=1,3 --difficulties=1.0,1.5,2.0 --out=.models/unified.json`
then `npx tsx scripts/hybrid.ts --ckpt=.models/unified.json --acts=1,3 --difficulties=1.0,1.5,2.0`.)

## What's here

| Area | Modules |
| --- | --- |
| **Observation / actions** | `encode.ts` (state → vector; append-only vocab manifest + structural fingerprint guard), `mask.ts` (73-slot action space + masking), `env.ts` (gym-style `CrawlerEnv`: reset/step/reward) |
| **Networks** | `net.ts` (MLP + hand-derived backprop + `trainStep`/`reinforceStep`), `entityNet.ts` (attention-pooling net; backprop **gradient-checked**) |
| **Search** | `mcts.ts`, `puct.ts` (net-guided + **hybrid** + prior dampening), `ismcts.ts` (determinized, learnable expert), `azsearch.ts` (net-guided determinized PUCT for self-play) |
| **Training** | behavioral cloning, distillation, determinized-Q (`determinized.ts`), **DAgger** (`dagger.ts`), **AlphaZero self-play** (`selfplay.ts`), reference **REINFORCE** (`reinforce.ts`) |

## Quick start

```sh
npm install
npm test            # full suite (search + engine)
npm run typecheck && npm run lint

# Watch the agent play (generates a self-contained docs/demo.html)
npx tsx scripts/demo.ts --enemyhp=2.0

# A unified cross-difficulty net, then evaluate search strength
npx tsx scripts/unified.ts --rounds=5 --out=.models/unified.json
npx tsx scripts/hybrid.ts  --ckpt=.models/unified.json --iters=160,400 --difficulties=1.0,1.5

# Reference actor-critic on the gym interface
npx tsx scripts/reinforce.ts --iters=80
```

Trained checkpoints are written to `.models/` (gitignored).

## How it works (in one paragraph)

The game hides the future (RNG) from the agent, making it a long-horizon planning problem —
so **search** does the lookahead and the **network's job is to guide it**, not to play alone.
The agent uses **hybrid PUCT**: the net's priors focus the search while honest rollouts give
leaf values, matching pure MCTS at fewer simulations. Training targets must be **learnable**
(a function of the observable state), which means **determinizing** any search expert
(ISMCTS / determinized-Q) and training **on-policy** (DAgger) to avoid distribution-shift
cascades. The same determinization makes **AlphaZero self-play** stable (no value collapse).

## Lessons (the durable ones)

- **Measure honestly:** fix one difficulty mechanism + seed set + sim budget before quoting a
  "ceiling." Several apparent ceilings in this project were artifacts.
- **Learnable targets + on-policy data.** Don't clone a clairvoyant expert; determinize it and
  use DAgger.
- **Expert consistency** matters for cloning — a deterministic heuristic clones far better than
  a strong-but-stochastic search.
- **Audit encoder ↔ game alignment** on every update (a hardcoded status list once silently
  dropped real mechanics; a structural fingerprint now guards it).

## License

MIT. The game engine is mirrored from
[claude-code-crawler](https://github.com/mitchjablonski/claude-code-crawler) (MIT); not
affiliated with or endorsed by Anthropic.
