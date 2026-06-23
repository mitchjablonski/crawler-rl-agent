"""Policy/value network for the AlphaZero-lite learner.

The default is an MLP whose weight layout matches src/search/net.ts exactly, so a
Python-trained net round-trips through the TS NetParams checkpoint format and is
loadable by the existing TS PUCT/eval. Swap `trunk` for an embedding + self-attention
entity encoder once the loop is validated; keep `to_netparams` only while the trunk
stays a single Linear (otherwise move to a Python-side forward + a TS bridge).
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class PolicyValueNet(nn.Module):
    def __init__(self, input_size: int, action_size: int, hidden: int = 128):
        super().__init__()
        self.input_size = input_size
        self.action_size = action_size
        self.hidden = hidden
        self.trunk = nn.Linear(input_size, hidden)
        self.policy_head = nn.Linear(hidden, action_size)
        self.value_head = nn.Linear(hidden, 1)

    def forward(self, x: torch.Tensor):
        h = F.relu(self.trunk(x))
        logits = self.policy_head(h)
        value = torch.sigmoid(self.value_head(h)).squeeze(-1)  # [0,1], matches TS
        return logits, value

    def to_netparams(self) -> dict:
        """Export to the TS NetParams JSON layout (row-major w1/wPolicy)."""
        return {
            "config": {
                "inputSize": self.input_size,
                "actionSize": self.action_size,
                "hidden": self.hidden,
            },
            "w1": self.trunk.weight.detach().cpu().flatten().tolist(),
            "b1": self.trunk.bias.detach().cpu().tolist(),
            "wPolicy": self.policy_head.weight.detach().cpu().flatten().tolist(),
            "bPolicy": self.policy_head.bias.detach().cpu().tolist(),
            "wValue": self.value_head.weight.detach().cpu().flatten().tolist(),
            "bValue": float(self.value_head.bias.detach().cpu()[0]),
        }

    def load_netparams(self, p: dict) -> None:
        cfg = p["config"]
        assert (
            cfg["inputSize"] == self.input_size
            and cfg["actionSize"] == self.action_size
            and cfg["hidden"] == self.hidden
        ), "NetParams dims do not match this model"
        with torch.no_grad():
            self.trunk.weight.copy_(torch.tensor(p["w1"]).view(self.hidden, self.input_size))
            self.trunk.bias.copy_(torch.tensor(p["b1"]))
            self.policy_head.weight.copy_(torch.tensor(p["wPolicy"]).view(self.action_size, self.hidden))
            self.policy_head.bias.copy_(torch.tensor(p["bPolicy"]))
            self.value_head.weight.copy_(torch.tensor(p["wValue"]).view(1, self.hidden))
            self.value_head.bias.copy_(torch.tensor([p["bValue"]]))
