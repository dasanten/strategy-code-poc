import { wrapDelta } from './shared/terrain.js'
import { BUILDING_NAMES } from './map/palette.js'
import {
  groupRequests,
  groupSkip,
  type GroupOrder,
  type GroupSeen,
  type GroupSend,
} from './group-orders.js'

/**
 * The who-list (`CONTEXT.md`: Who-list): the last step of a realm order, listing the realm's
 * residents who could take it, the nearest to the target first, with the nearest idle ones
 * ticked. Only the UI (ADR 0041): confirming sends those ticked what the group card sends.
 */

/** A resident as the who-list needs them: what a group order checks, and what they do. */
export type WhoResident = Parameters<typeof groupSkip>[1]

/** A realm order that reaches the who-list. */
export type WhoOrder = Extract<GroupOrder, { kind: 'build' }>

/**
 * How many of the nearest idle residents the who-list ticks for an order (`CONTEXT.md`:
 * Who-list, suggests): two builders get a house up in good time without emptying the city.
 */
export const WHO_SUGGESTS: Record<WhoOrder['kind'], number> = {
  build: 2,
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
  /**
   * Running a queue, a haul route or a script, which the order would cut short: their Now /
   * After switch starts on After (`startsWhen`).
   */
  keeps?: true
  /** How far their way is, in tiles: the way's own length, else as the crow flies. */
  tiles: number
  /** About how many ticks their way takes, if that can be told. */
  ticks?: number
  /** Why they can't take the order; such a row is greyed out and can't be ticked. */
  why?: string
}

/** What the who-list is for, its title: "Build a house", "Build an inn" (stone: "a stone wall"). */
export function whoTitle(order: WhoOrder): string {
  const name = `${order.material === 'stone' ? 'stone ' : ''}${BUILDING_NAMES[order.building].toLowerCase()}`
  return `Build ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
}

/** The reason a resident with no way to the target can't take the order. */
export const NO_WAY_THERE = 'no way there'

/**
 * Why a resident can't take a realm order, if they can't (`CONTEXT.md`: Who-list): what the
 * group card would skip them for (a child, a partner carrying a child), or no way there. Those
 * elsewhere are not skipped: a realm order walks them there first.
 */
export function whyNot(
  order: WhoOrder,
  r: WhoResident,
  way: WhoWay,
  { tick, size, seen }: { tick: number; size: number; seen?: GroupSeen },
): string | undefined {
  // Queued, a group order skips nobody for standing elsewhere: they walk there first.
  return groupSkip(order, r, tick, size, true, seen) ?? (way === 'none' ? NO_WAY_THERE : undefined)
}

/** Running a queue, a haul route or a script: something of their own that goes on and on. */
function keepsGoing(r: WhoResident): boolean {
  const kind = r.order?.kind
  return !!r.queue || !!r.script || kind === 'haul' || kind === 'haulByWater'
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
    const why = whyNot(order, r, way, ctx)
    const known = typeof way === 'object' ? way : undefined
    return {
      id: r.id,
      name: r.name,
      idle: !r.order && !r.script,
      ...(keepsGoing(r) ? { keeps: true as const } : {}),
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
 * What the who-list says over its rows: how many are ticked, and of them how many take the order
 * now and how many after ("3 ticked: 2 now, 1 after"), or that nobody is idle and so nobody was
 * ticked, or that nobody can take the order at all.
 */
export function whoNote(rows: readonly WhoRow[], ticked: number, after = 0): string {
  if (!rows.some((r) => r.why === undefined)) return 'Nobody can take this order.'
  if (ticked > 0) {
    const now = ticked - after
    const parts = [...(now > 0 ? [`${now} now`] : []), ...(after > 0 ? [`${after} after`] : [])]
    return `${ticked} ticked: ${parts.join(', ')}.`
  }
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

/**
 * When a ticked resident takes the order (`CONTEXT.md`: Who-list): **now**, replacing what they
 * are doing, or **after**, appended to their queue as Shift does on a card.
 */
export type WhoWhen = 'now' | 'after'

/**
 * Where a row's Now / After switch starts: After for someone running a queue, a haul route or a
 * script, Now for anyone else busy. An idle resident has no switch: undefined.
 */
export function startsWhen(row: Pick<WhoRow, 'idle' | 'keeps'>): WhoWhen | undefined {
  if (row.idle) return undefined
  return row.keeps ? 'after' : 'now'
}

/** A row's Now / After as the Player set it, else where it starts; undefined for the idle. */
export function whenOf(
  row: Pick<WhoRow, 'id' | 'idle' | 'keeps'>,
  set: Readonly<Record<string, WhoWhen>>,
): WhoWhen | undefined {
  if (row.idle) return undefined
  return set[row.id] ?? startsWhen(row)
}

/** Those of the ticked who take the order after what they do (`whenOf`), in the rows' order. */
export function tickedAfter(
  rows: readonly WhoRow[],
  ticked: readonly string[],
  set: Readonly<Record<string, WhoWhen>>,
): string[] {
  const on = new Set(ticked)
  return rows.filter((r) => on.has(r.id) && whenOf(r, set) === 'after').map((r) => r.id)
}

/**
 * The requests a confirmed realm order sends (`CONTEXT.md`: Who-list): to each of `to` what the
 * group card sends (`groupRequests`), replacing what they do, except those in `after`, who get
 * it appended to their queue as with Shift held. The requests come in `to`'s order; a walk-to
 * gives the two kinds different free tiles.
 */
export function realmRequests(
  order: GroupOrder,
  to: readonly WhoResident[],
  after: ReadonlySet<string>,
  ctx: {
    tick: number
    size: number
    free: (x: number, y: number) => boolean
    seen?: GroupSeen
  },
): GroupSend {
  const now = groupRequests(
    order,
    to.filter((r) => !after.has(r.id)),
    { ...ctx, queued: false },
  )
  // The tiles those going now were sent to are not free for those going after.
  const taken = new Set(
    now.requests.flatMap(({ order: o }) => (o.kind === 'walkTo' ? [`${o.x},${o.y}`] : [])),
  )
  const later = groupRequests(
    order,
    to.filter((r) => after.has(r.id)),
    { ...ctx, queued: true, free: (x, y) => !taken.has(`${x},${y}`) && ctx.free(x, y) },
  )
  const place = new Map(to.map((r, i) => [r.id, i]))
  const requests = [...now.requests, ...later.requests].sort(
    (a, b) => place.get(a.residentId)! - place.get(b.residentId)!,
  )
  return { requests, skipped: [...now.skipped, ...later.skipped] }
}

/**
 * How many rows the who-list draws at first, and how many more each Show more adds: the nearest
 * come first, so a big realm's list stays quick without drawing everyone.
 */
export const WHO_PAGE = 40

/** How many of the ticked the search and the filters hide. */
export function tickedHidden(ticked: readonly string[], shown: readonly Pick<WhoRow, 'id'>[]) {
  const listed = new Set(shown.map((r) => r.id))
  return ticked.filter((id) => !listed.has(id)).length
}
