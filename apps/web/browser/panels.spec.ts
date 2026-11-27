import { expect, logIn, test } from './fixtures.js'
import {
  card,
  clickSpot,
  clickTile,
  closeTab,
  controlMode,
  creativeBar,
  dockCard,
  everyTab,
  findSpot,
  openTab,
  pickResident,
  sidebar,
  tabButton,
  tileIn,
  tools,
} from './play.js'

// T126.2: every panel a Player opens in the first hour shows without an error (the fixture fails
// a flow on any console error or failed request).

test('every sidebar tab and every control of the map dock', async ({ page }) => {
  await logIn(page)
  const names = await tools(page)
    .getByRole('button', { name: /^(?!(Fold|Unfold) )/ })
    .all()
  expect(names.length).toBeGreaterThanOrEqual(8)
  for (const button of names) {
    const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText()))
      .replace(/, something new$/, '')
      .trim()
    await openTab(page, name)
    if (name === 'Scripts') {
      // A screen of its own over the map, the script workshop.
      const workshop = page.getByRole('region', { name: 'Script workshop' })
      await expect(workshop).toBeVisible()
      await workshop.getByRole('button', { name: /^« Back to the map/ }).click()
      await expect(workshop).toHaveCount(0)
      continue
    }
    await expect(sidebar(page).getByRole('heading', { level: 2, name }).first()).toBeVisible()
    if (name === 'Diplomacy') {
      const tabs = await everyTab(sidebar(page).getByRole('tablist', { name: 'Diplomacy' }))
      expect(tabs).toEqual(['Contracts', 'Demands', 'Direct offers', 'Alliance', 'Standing'])
    }
  }
  await closeTab(page)

  // The map dock: zoom, centre, the Select and Region map toggles, the legend with every art
  // style, and folding the minimap.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Centre on my residents' }).click()
  for (const name of ['Select', 'Region map']) {
    const toggle = page.getByRole('button', { name, exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
  const legend = page.getByRole('button', { name: 'Legend', exact: true })
  if ((await legend.getAttribute('aria-pressed')) !== 'true') await legend.click()
  const style = page.getByRole('combobox', { name: 'Art style' })
  for (const look of ['Tokens', 'Painted', 'Pixel']) {
    await style.selectOption(look)
    await expect(style).toHaveValue(/./)
  }
  await page.getByRole('button', { name: 'Fold the legend' }).click()
  await expect(style).toHaveCount(0)
  await page.getByRole('button', { name: 'Fold the minimap' }).click()
  await page.getByRole('button', { name: 'Minimap', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fold the minimap' })).toBeVisible()
})

test('the cards of a resident, a building, a tile and a stranger’s city', async ({ page }) => {
  await logIn(page)
  // A resident: every tab of their card.
  await pickResident(page, { doing: 'Working the farm' })
  const tabs = await everyTab(card(page).getByRole('tablist', { name: 'Card' }))
  expect(tabs).toEqual(['Orders', 'Queue', 'Stats', 'Script'])
  // Their Script tab names the farm they work at.
  await card(page).getByRole('tab', { name: 'Script' }).click()
  const farm = tileIn(
    await card(page)
      .getByText(/Farm at \d+, \d+/)
      .innerText(),
  )
  await card(page).getByRole('button', { name: 'Close the selection card' }).click()

  // A building: its card in the dock, every section it folds open.
  await controlMode(page, 'Realm')
  await clickTile(page, farm)
  const building = dockCard(page)
  await expect(building.getByRole('heading', { level: 2, name: /farm$/i })).toBeVisible()
  await expect(building.getByRole('region', { name: 'Crew' })).toBeVisible()
  for (const name of ['About the farm', 'Work settings']) {
    const fold = building.getByRole('button', { name, exact: true })
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
  }
  await building.getByRole('button', { name: 'Close the selection card' }).click()

  // A bare tile: its terrain and where it is.
  const spot = await findSpot(page, ({ readout }) => readout.startsWith('Plains'), { from: 4 })
  await clickSpot(page, spot)
  await expect(dockCard(page).getByRole('heading', { level: 2, name: 'Plains' })).toBeVisible()
  await expect(dockCard(page).getByText(`Tile ${spot.tile.x}, ${spot.tile.y}`)).toBeVisible()
  await dockCard(page).getByRole('button', { name: 'Close the selection card' }).click()

  // A stranger's city, from the Cities tab once Reveal shows the whole map: every section.
  const reveal = creativeBar(page).getByRole('button', { name: 'Reveal' })
  await reveal.click()
  await expect(reveal).toHaveAttribute('aria-pressed', 'true')
  try {
    await openTab(page, 'Cities')
    const others = sidebar(page).getByRole('list', { name: 'Others in sight' })
    const city = others.getByRole('button', { name: /· NPC city/ }).first()
    await city.click()
    await expect(city).toHaveAttribute('aria-expanded', 'true')
    // Only the opened row shows its sections.
    for (const section of ['Overview', 'Trade']) {
      await expect(others.getByText(section, { exact: true })).toBeVisible()
    }
  } finally {
    // Reveal is kept per session; switch it back off for the flows after.
    await reveal.click()
    await expect(reveal).toHaveAttribute('aria-pressed', 'false')
  }
  await expect(tabButton(page, 'Cities')).toBeVisible()
})
