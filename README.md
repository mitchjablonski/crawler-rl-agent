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

## Results (M38 content — 79 cards, 20 enemies, 21 relics, 8 potions, multi-act)

The agent is trained and evaluated across the full **difficulty × arc** grid. A single unified net
(DAgger across `--arcs=1,3 --difficulties=1.0,1.5,2.0`) is measured with **hybrid PUCT @160 sims**
over 20 held-out seeds:

| Difficulty | Single act — hybrid | 3-act arc — hybrid |
| --- | --- | --- |
| Base (1.0×) | **100%** | **100%** |
| Hard (1.5×) | **90%** | **100%** |
| Brutal (2.0×) | 55% | **95%** |

The same net, no-search vs. net-only-PUCT vs. hybrid at base (single act): **65% → 90% → 100%** — the
search does the lookahead the single forward pass can't, and the honest rollout leaf value closes the
last gap to 100%.

Two durable findings, both still true on M38:
- **Multi-act is *easier* for the searching agent, not harder.** The longer 3-act arc hands it more
  rests/shops/relics to recover with, so it meets or beats single-act at every difficulty — most
  starkly 3-act brutal **95%** vs single-act brutal **55%**.
- **At 2× the sim budget dominates.** Hybrid's leaf value comes from greedy rollouts, so single-act
  brutal is sim-bound at 160 sims; more sims lift it further (the 3-act arc compensates with recovery
  resources instead).

The encoder carries an explicit **act one-hot** (a "which arc" tier the continuous global `rowFrac`
blurs) and **held-potion counts** (M38's in-combat consumables). Reproduce:
`npx tsx scripts/unified.ts --arcs=1,3 --difficulties=1.0,1.5,2.0 --out=.models/unified.json`
then `npx tsx scripts/hybrid.ts --ckpt=.models/unified.json --acts=1,3 --difficulties=1.0,1.5,2.0`.

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
