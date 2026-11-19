import { ROAD_LINE_MAX_TILES } from '@csp/balance'
import { CARRYING_A_CHILD, GOODS } from './shared/world.js'
import { putAwayUnits, unitsThatFit } from './shared/goods.js'
import { wrapDelta } from './shared/terrain.js'
import type { Resident } from '@csp/shared-types'
import { GOOD_LABELS } from './goods-grid.js'
import { roadLine } from './shared/building.js'
import { BUILDING_NAMES } from './map/palette.js'
import { groupSkip, type GroupOrder, type GroupSeen } from './group-orders.js'
import { boundToTile, type BuildingGroupOrder } from './building-orders.js'
import { subjectLabel } from './Residents.js'
import { drivenCarriageId } from './shared/carriages.js'
import type { VehicleGroupOrder } from './vehicle-orders.js'

/**
 * The who-list (`CONTEXT.md`: Who-list): the last step of a realm order, listing the realm's
 * residents who could take it, the nearest to the target first, with the nearest idle ones
 * ticked. Only the UI (ADR 0041): confirming sends those ticked what the group card sends.
 */

/** A resident as the who-list needs them: what a group order checks, and what they do. */
export type WhoResident = Parameters<typeof groupSkip>[1] & Partial<Pick<Resident, 'stats'>>

/**
 * A realm order that reaches the who-list: Build, those a building's card starts, a road or
 * wall line, those about places and goods (`WhoPlaceOrder`), and those a carriage's or vessel's
 * card starts (`VehicleGroupOrder`).
 */
export type WhoOrder = BuildingGroupOrder | WhoLine | WhoPlaceOrder | VehicleGroupOrder

/**
 * A realm order about places and goods: Walk to, Explore, Run script and Relocate from the realm
 * bar, Store and Fetch from a storage's card.
 */
export type WhoPlaceOrder = Extract<
  GroupOrder,
  { kind: 'walkTo' | 'explore' | 'gather' | 'runScript' | 'relocate' | 'store' | 'fetch' }
>

/** A road or wall line given as a realm order. */
export type WhoLine = Extract<GroupOrder, { kind: 'line' }>

/** A tile of the map. */
type Tile = { x: number; y: number }

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
  // A road or wall line is shared tile by tile (`CONTEXT.md`: Build line): a third hand helps.
  line: 3,
  // One goes to look, explores, runs a script, moves or fetches; two of those carrying
  // something take it to the storage.
  walkTo: 1,
  explore: 1,
  // Two gatherers fill a storage twice as fast and take tiles side by side (`CONTEXT.md`: Gather).
  gather: 2,
  runScript: 1,
  relocate: 1,
  store: 2,
  fetch: 1,
  // One driver or rower; Board ticks as many as there are seats left (`vehicleSuggests`).
  haul: 1,
  drive: 1,
  row: 1,
  board: 1,
  boardBoat: 1,
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
  /**
   * Running a queue, a haul route or a script, which the order would cut short: their Now /
   * After switch starts on After (`startsWhen`).
   */
  keeps?: true
  /**
   * Busy, but After would end what they do (`afterOffered`): their row offers Now only, saying
   * there is no queue to add to.
   */
  noAfter?: true
  /** How far their way is, in tiles: the way's own length, else as the crow flies. */
  tiles: number
  /** About how many ticks their way takes, if that can be told. */
  ticks?: number
  /** Why they can't take the order; such a row is greyed out and can't be ticked. */
  why?: string
}

/**
 * What the who-list is for, its title: "Build a house", "Build an inn" (stone: "a stone wall"),
 * "Work at the farm", "Tear down the house", "Teach Strength", "Build a road line of 7 tiles" on
 * a map `size` tiles across, "Walk there", "Explore", "Run Woodcutter", "Relocate to Ashford",
 * "Store at the storage", "Fetch Wood from the stable". `names` names the script run or the city
 * moved to.
 */
export function whoTitle(
  order: WhoOrder,
  size = Infinity,
  names: { script?: string; city?: string } = {},
): string {
  switch (order.kind) {
    case 'walkTo':
      return 'Walk there'
    case 'explore':
      return 'Explore'
    case 'gather': {
      const good = order.params?.good
      return typeof good === 'string' ? `Gather ${good}` : 'Gather'
    }
    case 'runScript':
      return `Run ${names.script ?? 'a script'}`
    case 'relocate':
      return `Relocate to ${names.city ?? 'another city'}`
    case 'store':
      return `Store at the ${order.to?.name ?? 'nearest storage'}`
    case 'fetch':
      return `Fetch ${GOOD_LABELS[order.good]} from the ${order.from?.name ?? 'nearest storage'}`
    case 'line': {
      const tiles = lineTiles(order, size).length
      const name = `${order.material === 'stone' ? 'stone ' : ''}${order.building}`
      return `Build a ${name} line of ${tiles} ${tiles === 1 ? 'tile' : 'tiles'}`
    }
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
    case 'haul':
      return `Haul with the carriage to ${order.x}, ${order.y}`
    case 'drive':
      return `Drive the carriage to ${order.x}, ${order.y}`
    case 'row':
      return `Row the boat to ${order.x}, ${order.y}`
    case 'board':
      return 'Board the carriage'
    case 'boardBoat': {
      const name = order.vessel.kind === 'ship' ? 'ship' : 'boat'
      return order.asCrew ? `Board the ${name} as crew` : `Board the ${name}`
    }
  }
}

/** The reason a resident with no way to the target can't take the order. */
export const NO_WAY_THERE = 'no way there'

/**
 * Why a resident can't take a realm order, if they can't (`CONTEXT.md`: Who-list): what the
 * group card would skip them for (a child, a partner carrying a child), or no way there; for
 * Store carrying nothing but their own Food, for Relocate living in that city already or carrying
 * a child (`CONTEXT.md`: Relocate). Those elsewhere are not skipped: a realm order walks them there
 * first, so an order bound to the target's tile is judged as if they stood `at` it.
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
  const why = groupSkip(order, there, tick, size, true, seen)
  if (why) return why
  if (way === 'none') return NO_WAY_THERE
  // Boarding, queued or not: who is aboard already, and the driver (`CONTEXT.md`: Passenger).
  if (order.kind === 'board' || order.kind === 'boardBoat') {
    const id = order.kind === 'board' ? order.carriage.id : order.vessel.id
    if (r.aboard === id) return 'aboard already'
    if (r.aboard !== undefined) return 'aboard something else'
    if (drivenCarriageId({ order: r.order ?? null })) return 'the driver can’t board'
  }
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

/**
 * Where a realm order is, as the who-list says it: "at 4, 5" (`at`, its place), for a line
 * "from 4, 5 to 9, 5", or for one with no target tile what the list sorts by, "nearest the town
 * hall first".
 */
export function whoWhere(order: WhoOrder, at: WhoAt): string {
  if (at.near) return `nearest ${at.near} first`
  if (order.kind === 'line')
    return `from ${order.from.x}, ${order.from.y} to ${order.to.x}, ${order.to.y}`
  return `at ${at.x}, ${at.y}`
}

/** The tiles of a line from its start to its end (`roadLine`), on a map `size` tiles across. */
export function lineTiles(line: Pick<WhoLine, 'from' | 'to'>, size: number): Tile[] {
  return roadLine(line.from, line.to, size).map(([x, y]) => ({ x, y }))
}

/**
 * Why a road or wall line can't be built, said before the who-list (`CONTEXT.md`: Realm order),
 * as the Build line task would turn it down: longer than a line may be, or no tile on it to build.
 * `builds` says whether a tile takes the line's building or has a site of it to join.
 */
export function lineProblem(
  line: Pick<WhoLine, 'building' | 'from' | 'to'>,
  size: number,
  builds: (x: number, y: number) => boolean,
): string | undefined {
  const tiles = lineTiles(line, size)
  if (tiles.length > ROAD_LINE_MAX_TILES)
    return `a line covers at most ${ROAD_LINE_MAX_TILES} tiles`
  if (!tiles.some((t) => builds(t.x, t.y))) return `no ${line.building} to build on that line`
  return undefined
}

/**
 * The tile a resident's way to a realm order goes to: its place `at`, or for a line the line's
 * tile nearest them in steps, as the crow flies; of those as near, the one straightest across.
 */
export function wayTarget(order: WhoOrder, at: Tile, r: Tile, size: number): Tile {
  if (order.kind !== 'line') return at
  const far = (t: Tile) => {
    const across = Math.abs(wrapDelta(r.x, t.x, size)) + Math.abs(wrapDelta(r.y, t.y, size))
    return crowTiles(r, t, size) * 4 * size + across
  }
  return lineTiles(order, size).reduce((best, t) => (far(t) < far(best) ? t : best))
}

/** Running a queue, a haul route or a script: something of their own that goes on and on. */
function keepsGoing(r: WhoResident): boolean {
  const kind = r.order?.kind
  return !!r.queue || !!r.script || kind === 'haul' || kind === 'haulByWater'
}

/**
 * Whether a busy resident can take an order After what they do, finishing nothing early: only
 * when appending (`appendRequest`) keeps it, that is when they run a queue, or are on a walk of
 * their own, which becomes the queue's first step. For anyone else (a script or a task such as
 * Work or a haul route, or another order) the queue it would start ends what they do at once,
 * so After is not offered: "no queue to add to".
 *
 * Daniel's rule (#1444, 2026-11-18), in `CONTEXT.md` under Who-list.
 */
export function afterOffered(r: Pick<WhoResident, 'order' | 'script' | 'queue'>): boolean {
  return !!r.queue || (r.order?.kind === 'walkTo' && !r.script)
}

/** Why a row offers no After, beside its Now. */
export const NO_QUEUE = 'no queue to add to'

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
  /** The target, or each resident's own (`wayTarget`). */
  at: Tile | ((r: WhoResident) => Tile),
  wayOf: (r: WhoResident) => WhoWay,
  ctx: { tick: number; size: number; seen?: GroupSeen },
): WhoRow[] {
  const rows = residents.map((r): WhoRow => {
    const way = wayOf(r)
    const target = typeof at === 'function' ? at(r) : at
    const why = whyNot(order, r, way, { ...ctx, at: target })
    const known = typeof way === 'object' ? way : undefined
    const idle = !r.order && !r.script
    return {
      ...(!why && first(order, r, ctx.tick) ? { first: true as const } : {}),
      id: r.id,
      name: r.name,
      idle,
      ...(keepsGoing(r) ? { keeps: true as const } : {}),
      ...(!idle && !afterOffered(r) ? { noAfter: true as const } : {}),
      tiles: known ? known.tiles : crowTiles(r, target, ctx.size),
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
 * script, Now for anyone else busy, and always Now where After isn't offered (`noAfter`). An
 * idle resident has no switch: undefined.
 */
export function startsWhen(row: Pick<WhoRow, 'idle' | 'keeps' | 'noAfter'>): WhoWhen | undefined {
  if (row.idle) return undefined
  return row.keeps && !row.noAfter ? 'after' : 'now'
}

/**
 * A row's Now / After as the Player set it, else where it starts; Now where After isn't
 * offered; undefined for the idle.
 */
export function whenOf(
  row: Pick<WhoRow, 'id' | 'idle' | 'keeps' | 'noAfter'>,
  set: Readonly<Record<string, WhoWhen>>,
): WhoWhen | undefined {
  if (row.idle) return undefined
  if (row.noAfter) return 'now'
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
 * How many rows the who-list draws at first, and how many more each Show more adds: the nearest
 * come first, so a big realm's list stays quick without drawing everyone.
 */
export const WHO_PAGE = 40

/** How many of the ticked the search and the filters hide. */
export function tickedHidden(ticked: readonly string[], shown: readonly Pick<WhoRow, 'id'>[]) {
  const listed = new Set(shown.map((r) => r.id))
  return ticked.filter((id) => !listed.has(id)).length
}
