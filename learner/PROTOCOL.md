# Node-actor / Python-learner exchange protocol

Episode-level actor/learner split. Coordination happens at episode granularity via
file drops — never per engine step (a per-step Node↔Python bridge is a 10–100×
throughput hit; see ../docs/rl-and-search.md, or the upstream copy).

```
Node actors (TS engine + PUCT)                 Python learner (PyTorch, GPU)
  encode state -> (x, pi, mask, z)  --->  .az/replay/*.jsonl  --->  train
  load latest weights  <---  .az/weights/latest.json  <---  export NetParams
```

## Exchange dir (default `.az/`)

### `meta.json` — written by the actor at startup
```json
{ "inputSize": 201, "actionSize": 73, "hidden": 128, "manifest": { ... }, "fingerprint": "56393a09" }
```
- The learner sizes its net from `inputSize` / `actionSize` / `hidden`.
- `manifest` + `fingerprint` are echoed **verbatim** into exported checkpoints — the
  learner never recomputes the fingerprint, so there is no TS/Python hash drift.

### `replay/*.jsonl` — written by actors, read by the learner
One JSON object per line:
```json
{ "x": [/* inputSize */], "pi": [/* actionSize */], "mask": [/* actionSize */], "z": 0 }
```
- `pi`: PUCT visit distribution (0 on illegal slots, sums to 1).
- `mask`: 1 = legal, 0 = illegal.
- `z`: episode outcome (1 victory, 0 defeat) — identical for every step of an episode.

### `weights/latest.json` (+ `weights/checkpoint-{step}.json`) — written by the learner
A TS `Checkpoint`: `{ fingerprint, manifest, model: NetParams }`, where `NetParams`
matches `src/search/net.ts` exactly (row-major `w1`/`wPolicy`). The TS side loads it
via `checkpoint.ts` `loadCheckpoint` + `assertCompatible`.

## Loss (must match `src/search/net.ts` `trainStep`)
- **policy**: masked-softmax cross-entropy against `pi`.
- **value**: sigmoid output, MSE against `z`. (BCE is a likely upgrade; MSE matches TS.)

## Lifecycle
1. `npx tsx scripts/actor.ts --exchange=.az ...` — writes `meta.json`, then loops:
   load latest weights → self-play → append replay.
2. `python learner/train.py --exchange .az --watch` — trains on accumulating replay,
   exports weights; actors pick them up next round.

Coordination is intentionally loose (file drop). For production, add replay
rotation/consumption + a global step counter; this scaffold appends and retrains.
