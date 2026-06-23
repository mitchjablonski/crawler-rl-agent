import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    // REQ-1: the engine is pure — no IO, no clock, no ambient randomness,
    // and it imports nothing from the layers above it.
    files: ['src/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'util',
                'events',
                'stream',
              ],
              message: 'Engine must stay pure: no Node builtins.',
            },
            {
              group: ['ink', 'react', 'react/*', '@anthropic-ai/*'],
              message: 'Engine must not import UI or AI libraries.',
            },
            {
              group: [
                '**/ui/**',
                '**/events/**',
                '**/ai/**',
                '**/persistence/**',
                '**/modifiers/**',
                '**/cli*',
              ],
              message:
                'Engine is the bottom layer; it imports nothing from other layers.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG (src/engine/rng.ts).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Engine must not read the wall clock.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Engine must not read the wall clock.',
        },
      ],
    },
  },
);
