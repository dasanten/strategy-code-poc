import { expect, type Locator, type Page } from '@playwright/test'

/**
 * What the flows do over and over: open a tab or a resident, skip game time with the Creative
 * bar, and find a place on the map. The map is one canvas, so a place is found the way a Player
 * finds it: by pointing at the map and reading what the screen says about the tile under the
 * pointer (the readout under the minimap) and, while an order waits for a place, the pick banner
 * ("House here", "No room for a house: …").
 */

/** A point on the screen over the map, and the tile under it. */
export interface Spot {
  x: number
  y: number
  tile: { x: number; y: number }
  /** The readout's line for the tile, e.g. `Plains · 404, 389 · held by Smoke · middle zoom`. */
  readout: string
}

export const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
export const tools = (page: Page) => page.getByRole('navigation', { name: 'Tools' })
/** The card of what is picked in unit control mode (the command bar). */
export const card = (page: Page) => page.getByRole('region', { name: 'Selection' })
/** The card in the dock: a realm order's, a building's or a tile's. */
export const dockCard = (page: Page) => page.getByRole('complementary', { name: 'Selection' })
export const creativeBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Creative time controls' })
export const pickBanner = (page: Page) => page.getByRole('status').filter({ hasText: /^Click / })

/** A sidebar tab's button; its name gains ", something new" while it holds something unseen. */
export const tabButton = (page: Page, name: string) =>
  tools(page).getByRole('button', { name: new RegExp(`^${name}(, something new)?$`) })

/** Opens a sidebar tab, or leaves it open if it is. */
export async function openTab(page: Page, name: string) {
  const button = tabButton(page, name)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Folds the open sidebar tab, so the map is free again. */
export async function closeTab(page: Page) {
  const open = tools(page).getByRole('button', { pressed: true })
  if ((await open.count()) > 0) await open.first().click()
  await expect(tools(page).getByRole('button', { pressed: true })).toHaveCount(0)
}

/** Switches the control mode (ADR 0041). */
export async function controlMode(page: Page, mode: 'Unit' | 'Realm') {
  const radio = page.getByRole('radio', { name: mode })
  await radio.click()
  await expect(radio).toBeChecked()
}

/**
 * Picks a resident from the Residents tab, the `nth` who isn't the Leader (rows keep the list's
 * order), of those whose row says they are `doing` that if given, and folds the tab again.
 * Returns their name.
 */
export async function pickResident(
  page: Page,
  { nth = 0, doing }: { nth?: number; doing?: string } = {},
): Promise<string> {
  await controlMode(page, 'Unit')
  await openTab(page, 'Residents')
  const list = sidebar(page).getByRole('region', { name: 'Residents', exact: true }).last()
  let rows = list.getByRole('button', { name: /years/ }).filter({ hasNotText: 'Leader' })
  if (doing) rows = rows.filter({ hasText: doing })
  const row = rows.nth(nth)
  const name = /^\S+/.exec(await row.innerText())?.[0] ?? ''
  expect(name).not.toBe('')
  await row.click()
  await expect(card(page).getByRole('heading', { level: 2, name })).toBeVisible()
  await closeTab(page)
  return name
}

/** The game time the Creative bar shows. */
const gameTime = (bar: Locator) => bar.getByText(/^Year \d+ · Day \d+ · \d+:\d+$/)

/** The readout under the minimap: the tile under the pointer, ending in the zoom tier. */
const readoutOf = (page: Page) => page.getByText(/(far|middle|close) zoom$/)

/** Runs game time ahead with the Creative bar and waits until the skip is done. */
export async function skipAhead(page: Page, amount: number, unit: 'hours' | 'days') {
  const bar = creativeBar(page)
  const form = bar.getByRole('form', { name: 'Skip ahead' })
  await form.getByLabel('How many').fill(String(amount))
  await form.getByLabel('Unit').selectOption(unit)
  const before = await gameTime(bar).innerText()
  await form.getByRole('button', { name: 'Skip ahead' }).click()
  // While it runs the form gives way to its progress; then it comes back, the clock moved on.
  await expect(bar.getByRole('form', { name: 'Skip ahead' })).toBeVisible({ timeout: 120_000 })
  await expect(gameTime(bar)).not.toHaveText(before)
}

/**
 * Skips game time an hour at a time until `done` holds, at most `hours` hours, so a flow waits
 * only as long as the world needs.
 */
export async function skipUntil(page: Page, done: () => Promise<boolean>, hours = 24) {
  for (let hour = 0; hour < hours; hour++) {
    if (await done()) return
    await skipAhead(page, 1, 'hours')
  }
  expect(await done(), `still not done after ${hours} game hours`).toBe(true)
}

/** What the readout under the minimap says about the tile under the pointer, if it is one. */
async function readTile(page: Page): Promise<Pick<Spot, 'tile' | 'readout'> | undefined> {
  const readout = await readoutOf(page).innerText()
  const at = /(\d+), (\d+)/.exec(readout)
  return at ? { tile: { x: Number(at[1]), y: Number(at[2]) }, readout } : undefined
}

/** Whether the map's canvas itself is at a point of the screen, not a panel over it. */
async function mapAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ px, py }) => {
      const hit = document.elementFromPoint(px, py)
      return hit instanceof HTMLCanvasElement && !!hit.closest('[aria-label="World map"]')
    },
    { px: x, py: y },
  )
}

/**
 * Points at the map, ring by ring outwards from its middle, until `fits` accepts what the screen
 * says about the tile (its readout line and, while an order waits for a place, the pick banner).
 * Only points where the map is uncovered count, so a click there lands on it.
 */
export async function findSpot(
  page: Page,
  fits: (said: { readout: string; banner: string }) => boolean,
  { step = 24, rings = 14, from = 0 } = {},
): Promise<Spot> {
  const box = await page.getByRole('img', { name: 'World map' }).boundingBox()
  if (!box) throw new Error('The map is not on the screen')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const banner = pickBanner(page)
  for (let ring = from; ring <= rings; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ] as const) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
        const x = cx + dx * step
        const y = cy + dy * step
        if (!(await mapAt(page, x, y))) continue
        await page.mouse.move(x, y)
        const tile = await readTile(page)
        if (!tile) continue
        const said = (await banner.count()) > 0 ? await banner.innerText() : ''
        if (fits({ readout: tile.readout, banner: said })) return { x, y, ...tile }
      }
    }
  }
  throw new Error('No place on the map on screen fits')
}

/** The tile under a point of the screen, read from the readout after pointing there. */
async function tileAt(page: Page, x: number, y: number) {
  // The map reads the tile on a pointer move, so the pointer comes from beside it.
  await page.mouse.move(x - 2, y)
  await page.mouse.move(x, y)
  const tile = await readTile(page)
  if (!tile) throw new Error(`No tile under ${x}, ${y}`)
  return tile.tile
}

/**
 * Brings a tile under the pointer, wherever the camera went since (it follows a picked resident):
 * it reads the tile in the middle of the map, drags the map by the difference and corrects until
 * the readout names the tile. Returns where it now is on the screen.
 */
async function showTile(page: Page, tile: { x: number; y: number }): Promise<Spot> {
  const box = await page.getByRole('img', { name: 'World map' }).boundingBox()
  if (!box) throw new Error('The map is not on the screen')
  // Far out the map draws regions, not buildings: zoom in to the middle tier first.
  for (let i = 0; i < 8 && (await page.getByText(/far zoom$/).count()) > 0; i++) {
    await page.getByRole('button', { name: 'Zoom in' }).click()
  }
  // A point of the map no panel covers, near its middle.
  const free = await findSpot(page, () => true, { rings: 6 })
  const a = await tileAt(page, free.x, free.y)
  const b = await tileAt(page, free.x + 96, free.y)
  const scale = 96 / Math.max(1, b.x - a.x)
  let x = free.x
  let y = free.y
  for (let tries = 0; tries < 8; tries++) {
    const at = await tileAt(page, x, y)
    if (at.x === tile.x && at.y === tile.y) {
      const readout = (await readTile(page))?.readout ?? ''
      return { x, y, tile, readout }
    }
    const dx = (tile.x - at.x) * scale
    const dy = (tile.y - at.y) * scale
    if (tries < 3 && Math.hypot(dx, dy) > scale * 2) {
      // Far: drag the map so the tile comes to the free point (a drag pans in unit mode).
      const to = { x: x - dx, y: y - dy }
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
      const end = {
        x: clamp(to.x, box.x + 20, box.x + box.width - 20),
        y: clamp(to.y, box.y + 20, box.y + box.height - 20),
      }
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 8 })
      await page.mouse.up()
    } else {
      // Near: step the pointer instead, a tile's width at a time.
      x += Math.sign(dx) * Math.min(Math.abs(dx), scale)
      y += Math.sign(dy) * Math.min(Math.abs(dy), scale)
    }
  }
  throw new Error(`Tile ${tile.x}, ${tile.y} could not be brought under the pointer`)
}

/** Clicks a tile, bringing it on the screen first. */
export async function clickTile(page: Page, tile: { x: number; y: number }) {
  const spot = await showTile(page, tile)
  await page.mouse.click(spot.x, spot.y)
}

/** Clicks a spot found just before; the tile under the pointer must still be the one found. */
export async function clickSpot(page: Page, spot: Spot) {
  const at = await tileAt(page, spot.x, spot.y)
  expect(at).toEqual(spot.tile)
  await page.mouse.click(spot.x, spot.y)
}

/** Opens every tab of a tab list in turn; each must show its panel without an error. */
export async function everyTab(tabs: Locator) {
  const names = await tabs.getByRole('tab').allInnerTexts()
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) {
    const tab = tabs.getByRole('tab', { name: name.trim(), exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
  return names
}

/** The tile a text names as "at x, y" or "at (x, y)". */
export function tileIn(text: string): { x: number; y: number } {
  const at = /at \(?(\d+), (\d+)\)?/.exec(text)
  if (!at) throw new Error(`No tile in "${text}"`)
  return { x: Number(at[1]), y: Number(at[2]) }
}
