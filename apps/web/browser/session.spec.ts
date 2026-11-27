import { expect, logIn, test } from './fixtures.js'

// T126.2: logging out and in again comes back to the same realm and city.

// Waiting for #1734: Log out can still ask for terrain after the session ended.
test.use({ waitingFor: [{ bug: 1734, path: '/api/terrain/chunks', status: 401 }] })

test('log out and in again: the same city is there', async ({ page }) => {
  await logIn(page)
  const top = page.getByRole('banner')
  const city = await top.getByTitle('Your home city').innerText()
  await top.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('region', { name: 'Log in' })).toBeVisible()

  await logIn(page)
  await expect(page.getByRole('banner').getByTitle('Your home city')).toHaveText(city)
})
