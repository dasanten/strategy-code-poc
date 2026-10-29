import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // Worlds on the 10 m grid have 16 times the tiles: generating and running one takes a while.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Locally several sessions often check at once: each takes half the cores, not all of them.
    maxWorkers: process.env.CI ? undefined : '50%',
    // `pnpm check` runs only the tests affected by a change (ADR 0013); a change to one of these
    // runs them all.
    forceRerunTriggers: [
      '**/package.json',
      '**/pnpm-lock.yaml',
      '**/{vitest,vite}.config.*',
      '**/tsconfig*.json',
      '**/eslint.config.*',
    ],
  },
})
