CI was omitted from the initial push because the GitHub token lacked the `workflow` scope.
To add it: `gh auth refresh -h github.com -s workflow`, then restore a workflow that runs
`npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
