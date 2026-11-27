import { expect, logIn, test } from './fixtures.js'
import { card, openTab, pickResident } from './play.js'

// T126.2: the script workshop's checker, and a default script started from a resident's card.

test('the checker marks a script with an error', async ({ page }) => {
  await logIn(page)
  await openTab(page, 'Scripts')
  const workshop = page.getByRole('region', { name: 'Script workshop' })
  await workshop.getByRole('button', { name: 'New script' }).click()
  const editor = workshop.getByRole('main')
  await expect(editor.getByText('No syntax errors.')).toBeVisible()
  await editor.getByRole('textbox').click()
  await page.keyboard.type('let x = (\n')
  // The checker names the line and column, and says such a version never runs.
  await expect(editor.getByText(/^\d+:\d+ Expected /)).toBeVisible()
  await expect(editor.getByText(/never runs/)).toBeVisible()
  await expect(editor.getByText('No syntax errors.')).toHaveCount(0)

  // A default script opens read-only beside it, free of errors.
  await workshop.getByRole('button', { name: /^Work \(default\)/ }).click()
  await expect(editor.getByText(/^Work \(default\)/)).toBeVisible()
  await expect(editor.getByText('No syntax errors.')).toBeVisible()
  await workshop.getByRole('button', { name: /^« Back to the map/ }).click()
  await expect(workshop).toHaveCount(0)
})

test('a resident starts a default script', async ({ page }) => {
  await logIn(page)
  await pickResident(page, { doing: 'Working the farm', nth: 2 })
  await card(page).getByRole('button', { name: 'Run script…' }).click()
  const run = page.getByRole('region', { name: 'Run script' }).last()
  await run.getByRole('combobox', { name: 'Script to run' }).selectOption('Explore (default)')
  await run.getByRole('button', { name: 'Run script', exact: true }).click()
  await card(page).getByRole('tab', { name: 'Script' }).click()
  await expect(
    card(page).getByRole('region', { name: 'Script they run' }).getByText('Explore (default)'),
  ).toBeVisible()
})
