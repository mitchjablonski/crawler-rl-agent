#!/usr/bin/env bash
# Refresh the engine mirror from the upstream claude-code-crawler game repo.
#
# Pulls engine source / scripts / config updates from upstream WITHOUT touching our RL code.
# src/search/ is OURS except the four upstream-owned files (legalActions{,.test}.ts,
# mcts{,.test}.ts): we re-include those and exclude EVERYTHING ELSE under src/search/, so a
# refresh can never clobber an RL module (an allowlist of just-the-4 instead of a fragile,
# hand-maintained denylist of our ~25 files). Also preserved: our deepPairing config (.claude,
# .deeppairing, .mcp.json), project identity (README.md, .github CI, docs/, .gitignore,
# vitest.config.ts, tsconfig.scripts.json), and upstream's dev artifacts (.evolution-artifacts).
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
  --exclude='.evolution-artifacts' --exclude='.github' \
  --exclude='README.md' --exclude='docs' --exclude='.gitignore' \
  --exclude='vitest.config.ts' --exclude='tsconfig.scripts.json' \
  --exclude='package.json' \
  --include='src/search/legalActions.ts' --include='src/search/legalActions.test.ts' \
  --include='src/search/mcts.ts'         --include='src/search/mcts.test.ts' \
  --exclude='src/search/*' \
  "$UPSTREAM"/ "$HERE"/

echo "Installing deps..."
( cd "$HERE" && npm install --silent )

# package.json is preserved (holds our extra scripts, e.g. typecheck:scripts). Engine deps rarely
# change; if upstream added one, hand-merge it:  diff <(jq .dependencies "$UPSTREAM"/package.json) <(jq .dependencies "$HERE"/package.json)
echo "Done. Verify with: npx vitest run  (and: diff deps vs $UPSTREAM/package.json if a new mechanic needs a lib)"
