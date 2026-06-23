"""Python learner for the Node-actor / Python-learner AlphaZero-lite loop.

Reads replay (x, pi, mask, z) written by the TS self-play actors, trains a
policy/value net, and exports weights in the TS NetParams checkpoint format so the
existing TS PUCT/eval can load them. See PROTOCOL.md.

Scaffold note: the model is an MLP matching src/search/net.ts so the loop works
end-to-end today (with weight interop). Uses Adam (an upgrade over the TS plain
SGD) and runs on GPU when available. Swap PolicyValueNet's trunk for an
embedding+attention encoder once the loop is validated.

  python learner/train.py --exchange .az --watch
"""
from __future__ import annotations

import argparse
import json
import os
import time

import torch
import torch.nn.functional as F
from torch import optim

from data import load_replay
from exchange import read_meta, write_checkpoint
from model import PolicyValueNet


def masked_policy_loss(logits: torch.Tensor, pi: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Masked-softmax cross-entropy against pi (illegal slots excluded)."""
    neg = torch.finfo(logits.dtype).min
    masked = torch.where(mask > 0, logits, torch.full_like(logits, neg))
    logp = torch.log_softmax(masked, dim=-1)
    return -(pi * logp).sum(dim=-1).mean()  # pi is 0 on illegal slots


def train_round(model, opt, data, steps: int, batch: int, device: str) -> dict:
    x, pi, mask, z = (t.to(device) for t in data)
    n = x.shape[0]
    last: dict = {"loss": float("nan"), "policy": float("nan"), "value": float("nan")}
    for _ in range(steps):
        idx = torch.randint(0, n, (min(batch, n),), device=device)
        logits, value = model(x[idx])
        pl = masked_policy_loss(logits, pi[idx], mask[idx])
        vl = F.mse_loss(value, z[idx])
        loss = pl + vl
        opt.zero_grad()
        loss.backward()
        opt.step()
        last = {"loss": float(loss), "policy": float(pl), "value": float(vl)}
    return last


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exchange", default=".az")
    ap.add_argument("--steps", type=int, default=200)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--l2", type=float, default=1e-4)
    ap.add_argument("--watch", action="store_true", help="keep training as new replay arrives")
    ap.add_argument("--poll", type=float, default=5.0)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    meta = read_meta(args.exchange)
    model = PolicyValueNet(meta["inputSize"], meta["actionSize"], meta["hidden"]).to(args.device)

    latest = os.path.join(args.exchange, "weights", "latest.json")
    if os.path.exists(latest):
        with open(latest) as f:
            model.load_netparams(json.load(f)["model"])
        print("warm-started from", latest)

    opt = optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.l2)
    print(f"learner: device={args.device} in={meta['inputSize']} act={meta['actionSize']} "
          f"hidden={meta['hidden']} fp={meta['fingerprint']}")

    step = 0
    while True:
        data = load_replay(os.path.join(args.exchange, "replay"))
        if data is None:
            if not args.watch:
                print("no replay found; exiting")
                return
            time.sleep(args.poll)
            continue
        stats = train_round(model, opt, data, args.steps, args.batch, args.device)
        step += 1
        write_checkpoint(args.exchange, model, meta, step)
        print(f"step {step}: samples={data[0].shape[0]} loss={stats['loss']:.4f} "
              f"(p={stats['policy']:.4f} v={stats['value']:.4f}) -> weights/latest.json")
        if not args.watch:
            return
        time.sleep(args.poll)


if __name__ == "__main__":
    main()
