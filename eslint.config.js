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
  prettier,
)
