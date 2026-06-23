#!/usr/bin/env bash
# Refresh the engine mirror from the upstream claude-code-crawler game repo.
#
# Pulls engine source / scripts / config updates from upstream WITHOUT touching
# our RL additions (src/search/{encode,mask,vocab,checkpoint,net,train}*) or our
# deepPairing config (.claude, .deeppairing, .mcp.json). Upstream-owned search
# files (legalActions.ts, mcts.ts) ARE updated.
#
# Usage:  scripts/mirror-engine.sh [path-to-upstream]   (default: ../claudeCodeCrawler)
set -euo pipefail

UPSTREAM="${1:-../claudeCodeCrawler}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$UPSTREAM/src/engine" ]; then
  echo "error: upstream engine not found at '$UPSTREAM' (pass its path as arg 1)" >&2
  exit 1
fi

echo "Mirroring engine: $UPSTREAM -> $HERE"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='.claude' --exclude='.deeppairing' --exclude='.mcp.json' \
  --exclude='src/search/encode.ts'     --exclude='src/search/encode.test.ts' \
  --exclude='src/search/mask.ts'       --exclude='src/search/mask.test.ts' \
  --exclude='src/search/vocab.ts'      --exclude='src/search/vocab.test.ts' \
  --exclude='src/search/checkpoint.ts' --exclude='src/search/checkpoint.test.ts' \
  --exclude='src/search/net.ts'        --exclude='src/search/net.test.ts' \
  --exclude='src/search/train.ts' \
  "$UPSTREAM"/ "$HERE"/

echo "Installing deps..."
( cd "$HERE" && npm install --silent )

echo "Done. Verify with: npx vitest run"
