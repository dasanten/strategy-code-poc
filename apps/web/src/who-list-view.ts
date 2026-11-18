import { wrapDelta } from './shared/terrain.js'
import { BUILDING_NAMES } from './map/palette.js'
import { groupSkip, type GroupSeen } from './group-orders.js'
import { boundToTile, type BuildingGroupOrder } from './building-orders.js'
import { subjectLabel } from './Residents.js'

/**
 * The who-list (`CONTEXT.md`: Who-list): the last step of a realm order, listing the realm's
 * residents who could take it, the nearest to the target first, with the nearest idle ones
 * ticked. Only the UI (ADR 0041): confirming sends those ticked what the group card sends.
 */

/** A resident as the who-list needs them: what a group order checks, and what they do. */
export type WhoResident = Parameters<typeof groupSkip>[1]

/** A realm order that reaches the who-list: Build, and those a building's card starts. */
export type WhoOrder = BuildingGroupOrder

/**
 * How many of the nearest idle residents the who-list ticks for an order (`CONTEXT.md`:
 * Who-list, suggests): two builders get a house up (or one down) in good time without emptying
 * the city; one for the rest, a workplace's other places being the Player's call.
 */
export const WHO_SUGGESTS: Record<WhoOrder['kind'], number> = {
  build: 2,
  tearDown: 2,
  work: 1,
  feedStable: 1,
  breed: 1,
  teach: 1,
  train: 1,
}

/**
 * The way a resident would go to the target: its tiles and about how many ticks it takes
 * (`arrivalTicks`, when that can be told), `'none'` when there is no way there, or undefined
 * when it can't be told (the search gave up).
 */
export type WhoWay = { tiles: number; ticks?: number } | 'none' | undefined

/** One row of the who-list. */
export interface WhoRow {
  id: string
  name: string
  /** With neither an order nor a script (`isIdle`). */
  idle: boolean
  /** How far their way is, in tiles: the way's own length, else as the crow flies. */
  tiles: number
  /** About how many ticks their way takes, if that can be told. */
  ticks?: number
  /** Why they can't take the order; such a row is greyed out and can't be ticked. */
  why?: string
}

/**
 * What the who-list is for, its title: "Build a house", "Build an inn" (stone: "a stone wall"),
 * "Work at the farm", "Tear down the house", "Teach Strength".
 */
export function whoTitle(order: WhoOrder): string {
  switch (order.kind) {
    case 'build': {
      const stone = order.material === 'stone' ? 'stone ' : ''
      const name = `${stone}${BUILDING_NAMES[order.building].toLowerCase()}`
      return `Build ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
    }
    case 'work':
      return `Work at the ${order.name}`
    case 'tearDown':
      return `Tear down the ${order.name}`
    case 'feedStable':
      return 'Feed the stable'
    case 'breed':
      return 'Breed two horses'
    case 'teach':
      return `Teach ${subjectLabel(order.subject)}`
    case 'train':
      return 'Train at the training ground'
  }
}

/** The reason a resident with no way to the target can't take the order. */
export const NO_WAY_THERE = 'no way there'

/**
 * Why a resident can't take a realm order, if they can't (`CONTEXT.md`: Who-list): what the
 * group card would skip them for (a child, a partner carrying a child), or no way there. Those
 * elsewhere are not skipped: a realm order walks them there first, so an order bound to the
 * target's tile is judged as if they stood `at` it.
 */
export function whyNot(
  order: WhoOrder,
  r: WhoResident,
  way: WhoWay,
  {
    tick,
    size,
    seen,
    at,
  }: { tick: number; size: number; seen?: GroupSeen; at?: { x: number; y: number } },
): string | undefined {
  const there = at && boundToTile(order) ? { ...r, x: at.x, y: at.y } : r
  // Queued, a group order skips nobody for standing elsewhere: they walk there first.
  return (
    groupSkip(order, there, tick, size, true, seen) ?? (way === 'none' ? NO_WAY_THERE : undefined)
  )
}

/** How many tiles apart two tiles are as the crow flies, the short way round, diagonals one step. */
function crowTiles(a: { x: number; y: number }, b: { x: number; y: number }, size: number) {
  return Math.max(Math.abs(wrapDelta(a.x, b.x, size)), Math.abs(wrapDelta(a.y, b.y, size)))
}

/**
 * The who-list's rows (`CONTEXT.md`: Who-list): those who can take the order first, nearest to
 * `at` first, then those who can't, greyed out with why, nearest first too. As near, by name.
 */
export function whoRows(
  order: WhoOrder,
  residents: readonly WhoResident[],
  at: { x: number; y: number },
  wayOf: (r: WhoResident) => WhoWay,
  ctx: { tick: number; size: number; seen?: GroupSeen },
): WhoRow[] {
  const rows = residents.map((r): WhoRow => {
    const way = wayOf(r)
    const why = whyNot(order, r, way, { ...ctx, at })
    const known = typeof way === 'object' ? way : undefined
    return {
      id: r.id,
      name: r.name,
      idle: !r.order && !r.script,
      tiles: known ? known.tiles : crowTiles(r, at, ctx.size),
      ...(known?.ticks !== undefined ? { ticks: known.ticks } : {}),
      ...(why ? { why } : {}),
    }
  })
  return rows.sort(
    (a, b) =>
      Number(a.why !== undefined) - Number(b.why !== undefined) ||
      a.tiles - b.tiles ||
      a.name.localeCompare(b.name),
  )
}

/**
 * The game's suggestion (`CONTEXT.md`: Who-list): the nearest `n` idle residents who can take
 * the order, in the rows' order; none when nobody is idle.
 */
export function suggested(rows: readonly WhoRow[], n: number): string[] {
  return rows
    .filter((r) => r.idle && r.why === undefined)
    .slice(0, n)
    .map((r) => r.id)
}

/** The rows whose name holds the search, any case; all of them for an empty search. */
export function searched(rows: readonly WhoRow[], search: string): WhoRow[] {
  const s = search.trim().toLowerCase()
  return s === '' ? [...rows] : rows.filter((r) => r.name.toLowerCase().includes(s))
}

/**
 * What the who-list says over its rows: who is ticked, or that nobody is idle and so nobody
 * was ticked, or that nobody can take the order at all.
 */
export function whoNote(rows: readonly WhoRow[], ticked: number): string {
  if (!rows.some((r) => r.why === undefined)) return 'Nobody can take this order.'
  if (ticked > 0) return `${ticked} ticked.`
  if (!rows.some((r) => r.idle && r.why === undefined))
    return 'Nobody is idle, so nobody is ticked: tick who should do it.'
  return 'Nobody ticked: tick who should do it.'
}

/** Whether a row can be ticked: only those who can take the order. */
export const tickable = (row: WhoRow) => row.why === undefined

/** Ticks kept only for rows still listed and able to take the order. */
export function keptTicks(ticked: readonly string[], rows: readonly WhoRow[]): string[] {
  const ok = new Set(rows.filter(tickable).map((r) => r.id))
  return ticked.filter((id) => ok.has(id))
}
