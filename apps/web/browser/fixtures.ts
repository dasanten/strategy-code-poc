import { test as base, expect, type Page } from '@playwright/test'

/**
 * The browser tests' `test`: every flow fails on a console error, an uncaught error, a request
 * that failed or an answer of 400 or more, beyond the few a logged-out page expects (`EXPECTED`).
 * The problems are checked after the flow, so a flow that passes its own steps still fails on one.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      watch(page, problems)
      await use(problems)
      expect(problems, 'console errors and failed requests').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** What a page asks before anyone logs in, and the error the browser logs for it. */
const EXPECTED = [{ path: '/api/me', status: 401 }]

function expected(url: string, status: number) {
  const { pathname } = new URL(url)
  return EXPECTED.some((e) => e.path === pathname && e.status === status)
}

function watch(page: Page, problems: string[]) {
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // The browser logs every answer of 400 or more as an error; those are judged by `response`.
    const url = message.location().url
    if (message.text().startsWith('Failed to load resource') && url) return
    problems.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    // A navigation away (or the test ending) cancels what is still loading.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return
    problems.push(`failed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`)
  })
  page.on('response', (response) => {
    if (response.status() < 400 || expected(response.url(), response.status())) return
    problems.push(`answer ${response.status()}: ${response.request().method()} ${response.url()}`)
  })
}

/** Logs in as the test world's admin and founds their realm if it has none yet. */
export async function logIn(page: Page) {
  await page.goto('/')
  const login = page.getByRole('region', { name: 'Log in' })
  await login.getByLabel('Name').fill(process.env.BROWSER_USER ?? '')
  await login.getByLabel('Password').fill(process.env.BROWSER_PASSWORD ?? '')
  await login.getByRole('button', { name: 'Log in' }).click()
  const founding = page.getByRole('region', { name: 'Found your realm' })
  const map = page.getByRole('img', { name: 'World map' })
  await expect(founding.or(map).first()).toBeVisible()
  if (await founding.isVisible()) {
    await founding.getByLabel('Realm name').fill('Smoke')
    await founding.getByRole('button', { name: 'Found the realm' }).click()
  }
  await expect(map).toBeVisible()
}
