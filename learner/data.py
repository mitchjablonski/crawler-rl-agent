"""Load replay JSONL (written by the TS actors) into tensors."""
from __future__ import annotations

import glob
import json
import os

import torch


def load_replay(replay_dir: str):
    """Return (x, pi, mask, z) float tensors, or None if no replay exists yet."""
    xs, pis, masks, zs = [], [], [], []
    for path in sorted(glob.glob(os.path.join(replay_dir, "*.jsonl"))):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                xs.append(s["x"])
                pis.append(s["pi"])
                masks.append(s["mask"])
                zs.append(s["z"])
    if not xs:
        return None
    return (
        torch.tensor(xs, dtype=torch.float32),
        torch.tensor(pis, dtype=torch.float32),
        torch.tensor(masks, dtype=torch.float32),
        torch.tensor(zs, dtype=torch.float32),
    )
