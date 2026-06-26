import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The RL search-integration tests (ismcts/pretrain/train/eval) run full episodes
    // with search and can cross the 5s default under parallel CPU contention. Give a
    // generous ceiling so they don't flake. (Preserved across engine mirrors — see
    // scripts/mirror-engine.sh excludes.)
    testTimeout: 30000,
  },
});
