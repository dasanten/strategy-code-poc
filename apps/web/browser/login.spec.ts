import { expect, logIn, test } from './fixtures.js'

// T126.1: log in, the map shows, the Player's city and residents are there.
test('logs in and sees the city and its residents', async ({ page }) => {
  await logIn(page)
  await expect(page.getByRole('img', { name: 'World map' }).locator('canvas')).toBeVisible()

  const top = page.getByRole('banner')
  const city = (await top.getByTitle('Your home city').innerText()).replace(/^·/, '').trim()
  const leader = (await top.getByTitle('Your Leader').innerText()).trim()
  expect(city).not.toBe('')
  expect(leader).not.toBe('')

  const tools = page.getByRole('navigation', { name: 'Tools' })
  await tools.getByRole('button', { name: 'Residents', exact: true }).click()
  // The side panel; the list inside it is a region of the same name.
  const panel = page.getByRole('region', { name: 'Residents', exact: true }).first()
  await expect(panel.getByText(/^\d+ residents/)).toBeVisible()
  // The home city's group lists its residents, the Leader among them.
  const home = panel.getByRole('group', { name: city })
  await expect(home.getByRole('button', { name: new RegExp(`^${leader} Leader`) })).toBeVisible()
  expect(await home.getByRole('button').count()).toBeGreaterThan(1)
})
