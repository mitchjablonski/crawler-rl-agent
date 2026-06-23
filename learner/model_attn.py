"""Entity self-attention policy/value model — the AlphaZero-scale architecture upgrade.

Consumes the entity-tokenized observation (src/search/entityEncode.ts): a set of
typed tokens, each with a kind, a vocab id (card/enemy), and a feature vector.
Learned embeddings + a transformer encoder let the net model card<->card and
card<->enemy interactions that the flat MLP cannot.

IMPORTANT — runs on your GPU, not in the Node sandbox:
- Train here (PyTorch, autodiff, GPU). Self-play/PUCT stays in Node for engine
  fidelity, so Node needs a matching forward to run exported weights — see the
  "entity-forward bridge" step in learner/README.md. Unlike the MLP, this does NOT
  use the simple NetParams layout; export via `to_export()` and mirror it in TS.

Batched inputs (one row per state):
  types    [B, T]  long   token kind index (0..num_token_types-1)
  ids      [B, T]  long   vocab id SHIFTED by +1 (0 = "no id", for context/player)
  feats    [B, T, F] float
  pad_mask [B, T]  bool   True where the token slot is padding
"""
from __future__ import annotations

import torch
import torch.nn as nn


class EntityPolicyValueNet(nn.Module):
    def __init__(
        self,
        num_token_types: int,
        id_vocab: int,
        feat_dim: int,
        action_size: int,
        d_model: int = 128,
        nhead: int = 4,
        layers: int = 2,
        ff: int = 256,
    ):
        super().__init__()
        self.type_emb = nn.Embedding(num_token_types, d_model)
        # +1 slot, index 0 reserved as the "no id" / padding embedding.
        self.id_emb = nn.Embedding(id_vocab + 1, d_model, padding_idx=0)
        self.feat_proj = nn.Linear(feat_dim, d_model)
        enc_layer = nn.TransformerEncoderLayer(d_model, nhead, ff, batch_first=True)
        self.encoder = nn.TransformerEncoder(enc_layer, layers)
        self.policy_head = nn.Linear(d_model, action_size)
        self.value_head = nn.Linear(d_model, 1)

    def forward(self, types, ids, feats, pad_mask):
        x = self.type_emb(types) + self.id_emb(ids) + self.feat_proj(feats)
        h = self.encoder(x, src_key_padding_mask=pad_mask)
        summary = h[:, 0, :]  # the context token sits at position 0 (entityEncode.ts)
        logits = self.policy_head(summary)
        value = torch.sigmoid(self.value_head(summary)).squeeze(-1)  # [0,1], matches the engine
        return logits, value

    def to_export(self) -> dict:
        """All weights as nested lists + shapes, for the TS entity-forward bridge."""
        out = {"meta": {"impl": "entity-attn-v1"}}
        for k, v in self.state_dict().items():
            out[k] = {"shape": list(v.shape), "data": v.detach().cpu().flatten().tolist()}
        return out
