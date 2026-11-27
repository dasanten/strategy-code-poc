import { expect, logIn, test } from './fixtures.js'

// T126.2: the Wiki opens from the top bar, in a tab of its own, and its topics open from Contents.

test('the wiki and three of its topics', async ({ page }) => {
  await logIn(page)
  const [wiki] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('banner').getByRole('link', { name: 'Wiki' }).click(),
  ])
  await expect(wiki.getByRole('heading', { level: 1, name: 'Code Strategy Wiki' })).toBeVisible()
  const contents = wiki.getByRole('navigation', { name: 'Contents' })
  for (const topic of ['Queues', 'Food & hunger', 'Building & tearing down']) {
    await contents.getByRole('link', { name: topic, exact: true }).click()
    await expect(wiki.getByRole('heading', { name: topic, exact: true }).first()).toBeInViewport()
  }
  await expect(wiki.getByRole('link', { name: 'To the game' })).toBeVisible()
})
