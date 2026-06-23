# Contributing

Thanks for considering a contribution! This project has a small number of load-bearing rules. Honour these and most PRs will be easy to accept.

## Run the gate

```sh
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs exactly this on Node 20 and 22. Please make sure it's green locally first.

## Architecture contract

The code is strictly layered. `src/engine/` is the bottom and is **pure**:

- no I/O, no filesystem, no `Date`/`Date.now`, no `Math.random`
- no imports from any other layer (`ui`, `events`, `ai`, `modifiers`, `persistence`)

This is enforced by ESLint, not by trust — violations fail the build. Randomness comes from the seeded RNG in `src/engine/rng.ts`; the same seed and the same actions must always replay to byte-identical state. There are tests that assert this; don't weaken them.

Everything else layers on top and drives the engine only through `applyAction`.

## LLM flavors, code decides

The Dungeon AI may write **flavor only** — narration lines and the display names of things. It must never decide mechanics, amounts, or outcomes; those live in the engine's closed unions (`Effect`, `Modifier`, `EventOutcome`). AI-generated text lives in presentation surfaces the engine never reads, so it can't affect balance or replays even when it's wrong. New AI features must preserve this and must degrade to a complete experience with no AI backend at all.

## Content

Cards, enemies, relics, and events are plain data in `src/engine/content/`. Add to the arrays; `content.test.ts` checks the quota and that no id dangles. Keep new content composed from the existing effect primitives — if you think you need a new mechanic, open an issue first so we can discuss whether it belongs in the closed union.

## Tests

New behavior needs a test. The engine and pure modules are unit-tested directly; the TUI is exercised through `ink-testing-library` against an in-memory store and a fake event source (see `src/ui/App.test.tsx`).
