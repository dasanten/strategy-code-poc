import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // `.claude/` holds other sessions' worktrees: whole copies of the repo that must not be linted.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.claude/**',
      // Written by `pnpm types:rust` from the Rust crates (ADR 0030).
      'packages/shared-types/src/generated/**',
      // Written by `pnpm wasm:build` (T88.3).
      'packages/lang-wasm/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The client no longer depends on `@csp/shared` (T88.2, ADR 0030): its types come from
    // `@csp/shared-types`, its numbers from `@csp/balance` and its helpers live in
    // `apps/web/src/shared/`.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@csp/shared', '@csp/shared/*'],
              message:
                'The client is off @csp/shared: use @csp/shared-types, @csp/balance or ./shared/.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
