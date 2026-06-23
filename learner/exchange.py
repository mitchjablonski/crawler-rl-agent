"""File-drop exchange helpers (see PROTOCOL.md)."""
from __future__ import annotations

import json
import os
import time


def read_meta(exchange: str, timeout: float = 120.0, poll: float = 2.0) -> dict:
    """Read meta.json, waiting for the actor to publish it first."""
    path = os.path.join(exchange, "meta.json")
    waited = 0.0
    while not os.path.exists(path):
        if waited >= timeout:
            raise FileNotFoundError(
                f"no meta.json in {exchange} after {timeout}s; start scripts/actor.ts first"
            )
        time.sleep(poll)
        waited += poll
    with open(path) as f:
        return json.load(f)


def write_checkpoint(exchange: str, model, meta: dict, step: int) -> str:
    """Write a TS-compatible Checkpoint and atomically update latest.json."""
    wdir = os.path.join(exchange, "weights")
    os.makedirs(wdir, exist_ok=True)
    payload = json.dumps(
        {"fingerprint": meta["fingerprint"], "manifest": meta["manifest"], "model": model.to_netparams()}
    )
    with open(os.path.join(wdir, f"checkpoint-{step:05d}.json"), "w") as f:
        f.write(payload)
    tmp = os.path.join(wdir, "latest.json.tmp")
    with open(tmp, "w") as f:
        f.write(payload)
    os.replace(tmp, os.path.join(wdir, "latest.json"))  # atomic pointer swap
    return os.path.join(wdir, "latest.json")
