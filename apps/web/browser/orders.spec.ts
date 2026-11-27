import { expect, logIn, test } from './fixtures.js'
import {
  card,
  clickSpot,
  clickTile,
  controlMode,
  dockCard,
  findSpot,
  openTab,
  pickBanner,
  pickResident,
  sidebar,
  skipAhead,
  skipUntil,
  tileIn,
} from './play.js'

// T126.2: orders a Player gives in the first hour, with the Creative bar skipping the time they
// take. Each flow picks its own resident, so they don't undo each other's orders.

test('a resident walks where they are sent', async ({ page }) => {
  await logIn(page)
  const name = await pickResident(page)
  await card(page).getByRole('button', { name: 'Walk to' }).click()
  await expect(pickBanner(page)).toContainText('Click where to walk')
  // Plains a few tiles away from the city's crowd, nobody's building on it.
  const spot = await findSpot(page, ({ readout }) => readout.startsWith('Plains'), { from: 4 })
  await clickSpot(page, spot)
  await expect(card(page).getByText(`Walking to ${spot.tile.x}, ${spot.tile.y}`)).toBeVisible()

  // A resident walks some eight tiles a game hour.
  await skipUntil(
    page,
    async () =>
      (await card(page)
        .getByText(/^Walking to/)
        .count()) === 0,
  )
  // A click on the tile picks whoever of the Player's stands there: the resident sent.
  await card(page).getByRole('button', { name: 'Close the selection card' }).click()
  await clickTile(page, spot.tile)
  await expect(card(page).getByRole('heading', { level: 2, name })).toBeVisible()
  await expect(card(page).getByText(/^Walking to/)).toHaveCount(0)
})

test('a house placed from the build menu is built', async ({ page }) => {
  await logIn(page)
  await controlMode(page, 'Realm')
  await page
    .getByRole('region', { name: 'Realm bar' })
    .getByRole('button', { name: 'Build', exact: true })
    .click()
  const order = dockCard(page)
  await order.getByRole('button', { name: 'House', exact: true }).click()
  await order.getByRole('button', { name: 'Build house', exact: true }).click()
  await expect(pickBanner(page)).toContainText('Click where the house goes')
  const spot = await findSpot(page, ({ banner }) => banner.includes('House here'))
  await clickSpot(page, spot)

  // The who-list: the game suggests the nearest idle; with nobody idle, a busy one is ticked.
  await expect(order.getByRole('heading', { name: 'Build a house' })).toBeVisible()
  await expect(order.getByText(`at ${spot.tile.x}, ${spot.tile.y}`)).toBeVisible()
  const confirm = order.getByRole('button', { name: /^Confirm/ })
  if (await confirm.isDisabled()) {
    await order.getByRole('list', { name: 'Who does it' }).getByRole('checkbox').first().check()
  }
  await confirm.click()
  await expect(page.getByRole('status', { name: 'Last group order' })).toContainText('Sent to')

  // In realm control mode a click picks the building on the tile: "House site" while it is
  // built, then the house, named after its city.
  const built = async () => {
    await clickTile(page, spot.tile)
    await expect(dockCard(page).getByRole('heading', { level: 2, name: /house/i })).toBeVisible()
    return (
      (await dockCard(page)
        .getByText(/^Room for \d+ residents/)
        .count()) > 0
    )
  }
  await skipAhead(page, 1, 'days')
  await skipUntil(page, built, 24)
  await expect(dockCard(page).getByRole('heading', { level: 2, name: / house$/ })).toBeVisible()
})

test('a resident set to a workplace; the storage shows its goods', async ({ page }) => {
  await logIn(page)
  // Where the home city's storage stands, from its Trade section in the Cities tab.
  await openTab(page, 'Cities')
  await sidebar(page).getByRole('list', { name: 'Your cities' }).getByRole('button').first().click()
  const storage = tileIn(
    await sidebar(page)
      .getByRole('heading', { name: /^Offers at the storage at/ })
      .innerText(),
  )

  // A farmer of the new realm: their Script tab names the farm they work at.
  await pickResident(page, { doing: 'Working the farm' })
  await card(page).getByRole('tab', { name: 'Script' }).click()
  const farm = tileIn(
    await card(page)
      .getByText(/Farm at \d+, \d+/)
      .innerText(),
  )
  await card(page).getByRole('tab', { name: 'Orders' }).click()
  await card(page).getByRole('button', { name: 'Stop' }).click()
  await expect(card(page).getByText('Idle', { exact: true })).toBeVisible()

  // Work, with the workplace and the storage picked on the map in its start form.
  await card(page).getByRole('button', { name: 'Run script…' }).click()
  const run = page.getByRole('region', { name: 'Run script' }).last()
  await run.getByRole('combobox', { name: 'Script to run' }).selectOption('Work (default)')
  await run.getByRole('button', { name: 'Customise Run script' }).click()
  const form = page.getByRole('dialog', { name: 'Start Work (default)' })
  // Its building params in the order the form lists them: workplace, then storage.
  const pick = async (nth: number, tile: { x: number; y: number }) => {
    await form.getByRole('button', { name: 'Pick' }).nth(nth).click()
    await expect(pickBanner(page)).toBeVisible()
    await clickTile(page, tile)
    await expect(form.getByText(`at ${tile.x}, ${tile.y}`)).toBeVisible()
  }
  await expect(form.getByText('workplace', { exact: true })).toBeVisible()
  await pick(0, farm)
  await pick(1, storage)
  await form.getByRole('button', { name: 'Start' }).click()
  await expect(form).toHaveCount(0)
  await skipUntil(
    page,
    async () =>
      (await card(page)
        .getByText(/^Working/)
        .count()) > 0,
    6,
  )

  // The farm counts them in its crew; the storage shows its goods, Food among them.
  await controlMode(page, 'Realm')
  await clickTile(page, farm)
  await expect(dockCard(page).getByRole('heading', { level: 2, name: /farm$/i })).toBeVisible()
  await clickTile(page, storage)
  await expect(dockCard(page).getByRole('heading', { level: 2, name: /storage$/i })).toBeVisible()
  await expect(
    dockCard(page)
      .getByRole('listitem', { name: /^Food: \d+/ })
      .first(),
  ).toBeVisible()
})

test('a queue of two steps starts with its first', async ({ page }) => {
  await logIn(page)
  await pickResident(page, { doing: 'Working the farm', nth: 1 })
  await card(page).getByRole('tab', { name: 'Queue' }).click()
  const addStep = card(page).getByRole('region', { name: 'Add step' })
  const plains = ({ readout }: { readout: string }) => readout.startsWith('Plains')
  const addWalk = async (from: number) => {
    const open = addStep.getByRole('button', { name: 'Add step' })
    if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click()
    await addStep.getByRole('button', { name: 'Walk to', exact: true }).click()
    await expect(pickBanner(page)).toContainText('Click where to walk')
    const spot = await findSpot(page, plains, { from })
    await clickSpot(page, spot)
    return spot.tile
  }
  const firstStep = await addWalk(3)
  const steps = [firstStep, await addWalk(6)]
  // Both steps wait as a draft until the queue is started.
  const draft = card(page).getByRole('region', { name: 'Draft' })
  await expect(draft.getByText('Draft, not started')).toBeVisible()
  for (const [i, tile] of steps.entries()) {
    await expect(draft.getByText(`${i + 1}. Walk to ${tile.x}, ${tile.y}`)).toBeVisible()
  }
  await draft.getByRole('button', { name: 'Start queue' }).click()
  // The header says what they do now; the running queue shows the step they are on.
  const { x, y } = firstStep
  const first = `Walking to ${x}, ${y}`
  await expect(card(page).getByRole('strong').first()).toContainText(first)
  await expect(card(page).getByRole('region', { name: 'Queue' }).getByText(first)).toBeVisible()
})

test('an order given in realm control mode', async ({ page }) => {
  await logIn(page)
  await controlMode(page, 'Realm')
  // Residents are drawn but not picked: the card in the command bar gives way to the realm bar.
  await expect(card(page)).toHaveCount(0)
  await page
    .getByRole('region', { name: 'Realm bar' })
    .getByRole('button', { name: 'Walk to', exact: true })
    .click()
  await expect(pickBanner(page)).toBeVisible()
  const spot = await findSpot(page, ({ readout }) => readout.startsWith('Plains'), { from: 4 })
  await clickSpot(page, spot)
  // The who-list, nearest first; one is ticked and sent.
  const order = dockCard(page)
  const rows = order.getByRole('list', { name: 'Who does it' }).getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  for (const box of await rows.getByRole('checkbox', { checked: true }).all()) await box.uncheck()
  const name = /^\S+/.exec(await rows.first().innerText())?.[0] ?? ''
  await rows.first().getByRole('checkbox').check()
  await order.getByRole('button', { name: 'Confirm (1)' }).click()
  await expect(page.getByRole('status', { name: 'Last group order' })).toContainText('Sent to')

  // The same order a card would send: the Residents tab says where they are going.
  await openTab(page, 'Residents')
  const row = sidebar(page).getByRole('button', { name: new RegExp(`^${name} `) })
  await expect(row).toContainText(`Walking to ${spot.tile.x}, ${spot.tile.y}`)
  await expect(page.getByRole('radio', { name: 'Realm' })).toBeChecked()
})
