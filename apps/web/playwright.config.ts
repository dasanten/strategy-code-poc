import { defineConfig } from '@playwright/test'

// The browser smoke tests (Epic 126, ADR 0048). `pnpm test:browser` (`scripts/test-browser.mjs`)
// starts a creative server on a small world and runs these against it; it sets the variables read
// here. Run alone they have no server to talk to (knip only reads this file).
const { BROWSER_OUT, BROWSER_BASE_URL, BROWSER_CHANNEL } = process.env

export default defineConfig({
  testDir: 'browser',
  outputDir: BROWSER_OUT ?? '../../.browser-test/manual',
  // One world, one server: the flows run one after another, and a flow that fails is not retried.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: BROWSER_BASE_URL,
    // The browser installed on the machine (and on CI's runners): nothing to download.
    channel: BROWSER_CHANNEL ?? 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
