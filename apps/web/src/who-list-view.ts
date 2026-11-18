import { CARRYING_A_CHILD, GOODS } from './shared/world.js'
import { putAwayUnits, unitsThatFit } from './shared/goods.js'
import { wrapDelta } from './shared/terrain.js'
import type { Resident } from '@csp/shared-types'
import { BUILDING_NAMES } from './map/palette.js'
import { GOOD_LABELS } from './goods-grid.js'
import { groupSkip, type GroupOrder, type GroupSeen } from './group-orders.js'

/**
 * The who-list (`CONTEXT.md`: Who-list): the last step of a realm order, listing the realm's
 * residents who could take it, the nearest to the target first, with the nearest idle ones
 * ticked. Only the UI (ADR 0041): confirming sends those ticked what the group card sends.
 */

/** A resident as the who-list needs them: what a group order checks, and what they do. */
export type WhoResident = Parameters<typeof groupSkip>[1] & Partial<Pick<Resident, 'stats'>>

/** A realm order that reaches the who-list. */
export type WhoOrder = Extract<
  GroupOrder,
  { kind: 'build' | 'walkTo' | 'explore' | 'runScript' | 'relocate' | 'store' | 'fetch' }
>

/**
 * How many of the nearest idle residents the who-list ticks for an order (`CONTEXT.md`:
 * Who-list, suggests): two builders get a house up in good time without emptying the city; one
 * goes to look, explores, runs a script, moves or fetches; two of those carrying something take
 * it to the storage.
 */
export const WHO_SUGGESTS: Record<WhoOrder['kind'], number> = {
  build: 2,
  walkTo: 1,
  explore: 1,
  runScript: 1,
  relocate: 1,
  store: 2,
  fetch: 1,
}

/**
 * Where the who-list measures from: the order's target tile, or for an order with none (Explore,
 * Run script without a place) a place it names instead, `near`, which the list says it sorts by.
 */
export interface WhoAt {
  x: number
  y: number
  /** What the list sorts by distance to, when it isn't the order's target: "the town hall". */
  near?: string
}

/** The who-list's first line: where it measures from, then its question. */
export function whoAtLine(at: WhoAt): string {
  const where = at.near ? `nearest ${at.near} first` : `at ${at.x}, ${at.y}`
  return `${where} · who does it?`
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
  /** Listed ahead of the others who can take it: for Fetch, has room for the good. */
  first?: true
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
 * "Walk there", "Explore", "Run Woodcutter", "Relocate to Ashford", "Store at the storage",
 * "Fetch Wood from the stable". `names` names the script run or the city moved to.
 */
export function whoTitle(order: WhoOrder, names: { script?: string; city?: string } = {}): string {
  switch (order.kind) {
    case 'build': {
      const name = `${order.material === 'stone' ? 'stone ' : ''}${BUILDING_NAMES[order.building].toLowerCase()}`
      return `Build ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
    }
    case 'walkTo':
      return 'Walk there'
    case 'explore':
      return 'Explore'
    case 'runScript':
      return `Run ${names.script ?? 'a script'}`
    case 'relocate':
      return `Relocate to ${names.city ?? 'another city'}`
    case 'store':
      return `Store at the ${order.to?.name ?? 'nearest storage'}`
    case 'fetch':
      return `Fetch ${GOOD_LABELS[order.good]} from the ${order.from?.name ?? 'nearest storage'}`
  }
}

/** The reason a resident with no way to the target can't take the order. */
export const NO_WAY_THERE = 'no way there'

/**
 * Why a resident can't take a realm order, if they can't (`CONTEXT.md`: Who-list): what the
 * group card would skip them for (a child, a partner carrying a child), no way there, for Store
 * carrying nothing, and for Relocate living in that city already or carrying a child
 * (`CONTEXT.md`: Relocate). Those elsewhere are not skipped: a realm order walks them there first.
 */
export function whyNot(
  order: WhoOrder,
  r: WhoResident,
  way: WhoWay,
  { tick, size, seen }: { tick: number; size: number; seen?: GroupSeen },
): string | undefined {
  // Queued, a group order skips nobody for standing elsewhere: they walk there first.
  const why = groupSkip(order, r, tick, size, true, seen)
  if (why) return why
  if (way === 'none') return NO_WAY_THERE
  // Their own Food stays in their hands (`CONTEXT.md`: Own food).
  if (order.kind === 'store' && !GOODS.some((g) => putAwayUnits(g, r.carried[g] ?? 0) > 0))
    return 'carries nothing to store'
  if (order.kind === 'relocate') {
    if (r.carrying) return CARRYING_A_CHILD
    if (r.cityId === order.cityId) return 'lives there already'
  }
  return undefined
}

/**
 * Whether the who-list lists a resident who can take the order before the rest (`CONTEXT.md`:
 * Who-list): for Fetch, one with room for the good. For other orders anyone is as good.
 */
function first(order: WhoOrder, r: WhoResident, tick: number): boolean {
  // Room is told by strength, which the Player knows of their own.
  return (
    order.kind === 'fetch' &&
    r.stats !== undefined &&
    unitsThatFit(r as Resident, order.good, tick) > 0
  )
}

/** How many tiles apart two tiles are as the crow flies, the short way round, diagonals one step. */
function crowTiles(a: { x: number; y: number }, b: { x: number; y: number }, size: number) {
  return Math.max(Math.abs(wrapDelta(a.x, b.x, size)), Math.abs(wrapDelta(a.y, b.y, size)))
}

/**
 * The who-list's rows (`CONTEXT.md`: Who-list): those who can take the order first, nearest to
 * `at` first (for Fetch, those with room ahead of those without), then those who can't, greyed
 * out with why, nearest first too. As near, by name.
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
    const why = whyNot(order, r, way, ctx)
    const known = typeof way === 'object' ? way : undefined
    return {
      ...(!why && first(order, r, ctx.tick) ? { first: true as const } : {}),
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
      Number(!a.first) - Number(!b.first) ||
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
