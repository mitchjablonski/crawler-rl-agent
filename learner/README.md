# Python learner (scaffold)

Episode-level **Node-actor / Python-learner** split for the AlphaZero-lite agent.
The TS engine + PUCT run self-play (fast, single source of game truth); a PyTorch
learner trains the net (autodiff + GPU + room for modern architectures). They meet
only via file drops — see [PROTOCOL.md](PROTOCOL.md).

## Why this split
- The mulberry32 engine RNG and the game logic stay in TS (byte-identical replay,
  no risky port). A per-step Node↔Python bridge would be a 10–100× throughput hit.
- Training moves to PyTorch, where autodiff removes the hand-derived-gradient risk,
  GPU accelerates batched updates, and swapping the MLP for an embedding+attention
  entity encoder is straightforward.

## Setup
```bash
cd learner
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run the loop
Two processes, from the repo root:
```bash
# 1) Node actors: self-play + replay, reload learner weights each round
npx tsx scripts/actor.ts --exchange=.az --rounds=50 --episodes=12 --iters=48 --positional=false

# 2) Python learner: train on accumulating replay, export TS-loadable weights
python learner/train.py --exchange .az --watch --steps 200 --batch 256
```
The learner writes `.az/weights/latest.json` (a TS `Checkpoint`); the actor reloads
it and `assertCompatible`-checks it before the next self-play round. Evaluate a
learner checkpoint with the existing TS tools, e.g. point `scripts/distill.ts`
`--teacher` at it, or load it in a small eval script via `loadCheckpoint`.

## Files
- `model.py` — `PolicyValueNet`; MLP matching `src/search/net.ts`, with
  `to_netparams` / `load_netparams` for interop. Replace the trunk to go bigger.
- `data.py` — replay JSONL → tensors.
- `train.py` — learner loop (Adam, masked policy CE + value MSE, checkpoint export).
- `exchange.py` — `meta.json` / `weights/` file helpers.

## Status
Scaffold: the loop runs end-to-end with the MLP. Not yet done — replay
rotation/consumption (it currently retrains on all replay each step), prioritized
sampling, and a self-play↔learner sync policy.

## AlphaZero-scale (entity-attention) track

The flat MLP guides PUCT worse than pure rollout MCTS (which is 100% at base);
the learned value-at-leaf is the bottleneck. The upgrade is a learned-embedding +
self-attention entity encoder.

**Built + unit-tested (in Node):**
- `src/search/entityEncode.ts` — the tokenized observation (context/player/card/
  enemy tokens, each with a vocab id + features). This is the model input.
- `learner/model_attn.py` — `EntityPolicyValueNet`: per-kind type embeddings + a
  shared id embedding + feature projection → `TransformerEncoder` → policy/value
  heads off the context token. Trains on your GPU (autodiff, batched).

**Remaining (needs your PyTorch/GPU environment):**
1. **TS entity-forward bridge** — reimplement `EntityPolicyValueNet.forward` in TS
   (embeddings + multi-head attention + FFN + layernorm + residual) so Node-PUCT
   can run exported weights. Build this *with the Python model available*: export a
   tiny model via `to_export()`, run both forwards on the same tokens, and assert
   they match within ~1e-4 (golden test). Do not ship it unvalidated — a transformer
   forward has many places to silently diverge.
2. **Actor token emission** — have `scripts/actor.ts` write entity tokens (types,
   ids, feats, pad mask) to replay instead of the flat vector.
3. **Training loop** — `train.py` variant that batches tokenized replay, trains
   `EntityPolicyValueNet`, and exports for the bridge. Warm-start the policy from the
   MCTS-expert data; train value on-policy from net-PUCT self-play outcomes.
4. **Scale** — many self-play games (the actor parallelism was deferred by choice;
   re-enable when ready), GPU training, periodic net-PUCT eval vs the pure-MCTS 100%.

**Honest expectation:** base difficulty is already solved by pure clairvoyant MCTS
(100%, no net). The attention net's payoff is (a) matching that strength at far fewer
sims / instantly, and (b) the elevated-difficulty tiers (1.5x/2.0x). For this small
game it may not beat pure search; the value is the capability and the cleaner agent.
