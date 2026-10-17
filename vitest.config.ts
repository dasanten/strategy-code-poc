import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
})
