import {
  CARRYING_A_CHILD,
  GOODS,
  boarderProblem,
  canHandle,
  canWork,
  covers,
  isAt,
  wrap,
  wrapDelta,
  type Building,
  type BuildingKind,
  type Carriage,
  type Good,
  type Horse,
  type OrderRequest,
  type Resident,
  type ScriptSummary,
  type StartParamValues,
  type Stock,
} from '@csp/shared'
import { appendRequests, storeAll } from './queue-view.js'
import type { ActionId, OrderGroup } from './selection-view.js'

/**
 * One command for a group (`CONTEXT.md`: Group): the orders the group card offers, each sent to
 * every resident in it as the same order request a resident's own card sends.
 */
export type GroupOrder =
  | { kind: 'walkTo'; x: number; y: number }
  | ({ kind: 'work'; workplace: Pick<Building, 'id' | 'kind' | 'x' | 'y'>; name: string } & Starts)
  | ({ kind: 'build'; building: BuildingKind; at: { x: number; y: number } } & Starts)
  /** Everything carried to the nearest storage, or to the one picked (`to`). */
  | { kind: 'store'; to?: Place }
  /** As much as fits of a good from the nearest storage holding it, or from the one picked. */
  | { kind: 'fetch'; good: Good; from?: Place }
  /** Everything carried put down on their own tile. */
  | { kind: 'drop' }
  | ({ kind: 'runScript'; scriptId: number } & Starts)
  /** Picks each one's defence script, null for Defend (`CONTEXT.md`: Defence script). */
  | ({ kind: 'setDefenceScript'; scriptId: number | null } & Starts)
  | { kind: 'stop' }
  /**
   * Boards the carriage (`CONTEXT.md`: Passenger): those on its tile, in the group's order, until
   * its `seats` are taken.
   */
  | {
      kind: 'board'
      carriage: Pick<Carriage, 'id' | 'x' | 'y' | 'realmId' | 'cityId'>
      seats: number
    }
  | { kind: 'getOff' }
  /**
   * Sets a number param (`CONTEXT.md`: Script parameter), or clears it with null, for each one
   * running one of `scriptIds`, the scripts that declare it.
   */
  | { kind: 'setNumber'; name: string; value: number | null; scriptIds: readonly number[] }
  /** Each mounts a free horse of the realm on their tile, a different one each (`CONTEXT.md`: Riding). */
  | { kind: 'mount' }
  | { kind: 'dismount' }
  /**
   * Each unhitches the horse from a carriage of the realm on their tile, a different one each
   * (`CONTEXT.md`: Hitched horse).
   */
  | { kind: 'unhitch' }
  /** Each drives the carriage on their tile there, a different one each. */
  | { kind: 'drive'; x: number; y: number }
  /**
   * Each hauls with the carriage on their tile between their tile and the other stop
   * (`CONTEXT.md`: Haul route), a different carriage each.
   */
  | { kind: 'haul'; x: number; y: number; goods: Good[]; returnGoods: Good[]; keepFood: number }
  /** Each feeds the stable they stand in (`CONTEXT.md`: Feeding the stable). */
  | { kind: 'feedStable' }
  /** Each builds road or wall along the same line (`CONTEXT.md`: Road, Wall / Gate). */
  | {
      kind: 'line'
      line: 'roadLine' | 'wallLine'
      from: { x: number; y: number }
      to: { x: number; y: number }
    }
  /** Those standing at the building tear it down. */
  | { kind: 'tearDown'; building: Pick<Building, 'id' | 'kind' | 'x' | 'y'>; name: string }
  /**
   * Two horses bred at a stable (`CONTEXT.md`: Breeding): one breeder for a pair, so it goes to
   * the first one standing there who isn't breeding yet.
   */
  | { kind: 'breed'; stable: Pick<Building, 'id' | 'kind' | 'x' | 'y'>; horseIds: [string, string] }
  /** Each attacks the same resident of another realm, or breaks the same wall or gate. */
  | { kind: 'attack'; targetId: string }
  /** Those standing next to the wall or gate climb over it. */
  | { kind: 'climb'; wall: Pick<Building, 'id' | 'x' | 'y'> }

/** A storage, stable or carriage picked on the map to store at or fetch from. */
export interface Place {
  id: string
  name: string
}

/** What some group orders need of what the Player sees, beyond the residents in the group. */
export interface GroupSeen {
  /** Horses of the realm that pull no carriage and nobody rides, to mount. */
  horses?: readonly Pick<Horse, 'id' | 'x' | 'y'>[]
  /** The realm's carriages, to drive or haul with, and whether a horse is hitched to unhitch. */
  carriages?: readonly (Pick<Carriage, 'id' | 'x' | 'y'> & Partial<Pick<Carriage, 'horseId'>>)[]
  /** The buildings in sight, to find the stable each one stands in. */
  buildings?: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'site'>[]
}

/**
 * A group order that starts a script: the values for its params, the same for each of them
 * (`CONTEXT.md`: Script parameter, Before it starts).
 */
interface Starts {
  params?: StartParamValues
}

/** A resident the order wasn't sent to, or that the server turned down, and why. */
export interface Skipped {
  id: string
  name: string
  why: string
}

/** What a group order sends: one request per resident it goes to, and who is skipped. */
export interface GroupSend {
  requests: { residentId: string; order: OrderRequest }[]
  skipped: Skipped[]
}

/** How far from the target a group's walk-to looks for free tiles, in tiles each way. */
const SPREAD_RADIUS = 8

type GroupResident = Pick<
  Resident,
  'id' | 'name' | 'x' | 'y' | 'bornAt' | 'carried' | 'owner' | 'cityId'
> &
  Partial<Pick<Resident, 'carrying' | 'order' | 'script' | 'queue' | 'aboard' | 'riding'>>

/** The goods carried, at least one unit of each. */
const carriedGoods = (stock: Stock): Good[] => GOODS.filter((g) => (stock[g] ?? 0) > 0)

/**
 * Orders a child can't take (`CONTEXT.md`: Child): working, building, driving. Goods they handle
 * only Food (`canHandle`).
 */
const ADULTS_ONLY: GroupOrder['kind'][] = [
  'work',
  'build',
  'feedStable',
  'line',
  'tearDown',
  'breed',
  'drive',
  'haul',
  'unhitch',
]

/** Orders one carrying a child can't take (`CONTEXT.md`: Carrying). */
const NOT_CARRYING: GroupOrder['kind'][] = ['work', 'build', 'line', 'tearDown', 'breed', 'haul']

/** The thing on a resident's tile, if one is there. */
const onTile = <T extends { x: number; y: number }>(
  r: { x: number; y: number },
  things: readonly T[] | undefined,
) => things?.filter((t) => t.x === r.x && t.y === r.y) ?? []

/** Whether two tiles touch along a side, the short way round the map. */
const besides = (a: { x: number; y: number }, b: { x: number; y: number }, size: number) =>
  Math.abs(wrapDelta(a.x, b.x, size)) + Math.abs(wrapDelta(a.y, b.y, size)) === 1

/** The finished stable a resident stands in, if they stand in one. */
function stableOf(r: GroupResident, seen: GroupSeen, size: number) {
  return seen.buildings?.find((b) => b.kind === 'stable' && !b.site && covers(b, r.x, r.y, size))
}

/**
 * Why a resident of the group can't take the order, if they can't (`CONTEXT.md`: Child,
 * Carrying): children don't work, build or drive, and fetch and put down only Food; a partner
 * carrying a child doesn't work, build, tear down, breed or haul. Tile-bound orders go only to
 * those standing there: Work and Tear down at the building, Breed at the stable, Feed the stable
 * in one, Climb next to the wall, Drive and Haul on a carriage, Mount on a free horse's tile.
 * Walking, attacking, running a script and stopping go to everyone. Board goes to those who could
 * board the carriage, room aside (`boarderProblem`), Get off to those aboard one. Queued (Shift
 * held), Work, Tear down and Breed also go to those away from the place, who walk there first,
 * Store to those carrying nothing yet, and Board and Get off to everyone: whether they can is
 * checked when the step's turn comes. A number param goes to those running a script that has it.
 */
export function groupSkip(
  order: GroupOrder,
  r: GroupResident,
  tick: number,
  size: number,
  queued = false,
  seen: GroupSeen = {},
) {
  if (order.kind === 'setNumber')
    return r.script && order.scriptIds.includes(r.script.scriptId)
      ? undefined
      : `runs no script with ${order.name}`
  if (ADULTS_ONLY.includes(order.kind) && !canWork(r as Resident, tick)) return 'a child'
  if (order.kind === 'fetch' && !canHandle(r as Resident, tick, [order.good])) return 'a child'
  if (order.kind === 'drop' && !canHandle(r as Resident, tick, carriedGoods(r.carried)))
    return 'a child'
  if (NOT_CARRYING.includes(order.kind) && r.carrying) return CARRYING_A_CHILD
  switch (order.kind) {
    case 'mount':
      if (r.riding !== undefined) return 'already riding'
      if (onTile(r, seen.horses).length === 0) return 'no free horse here'
      break
    case 'dismount':
      if (r.riding === undefined) return 'not riding'
      break
    case 'unhitch':
      if (!onTile(r, seen.carriages).some((k) => k.horseId)) return 'no hitched horse here'
      break
    case 'drive':
    case 'haul':
      // A rider doesn't drive (`CONTEXT.md`: Riding).
      if (order.kind === 'drive' && r.riding !== undefined) return 'dismount first to drive'
      if (onTile(r, seen.carriages).length === 0) return 'no carriage here'
      break
    case 'feedStable':
      if (!stableOf(r, seen, size)) return 'not at a stable'
      break
    case 'climb':
      if (!besides(r, order.wall, size)) return 'not next to the wall'
      break
    case 'drop':
      if (carriedGoods(r.carried).length === 0) return 'carries nothing'
      break
  }
  if (queued) return undefined
  if (order.kind === 'board') {
    const why = boarderProblem({ ...r, order: r.order ?? null }, order.carriage)
    return why === 'that carriage is not on the resident’s tile' ? 'not there' : why
  }
  if (order.kind === 'getOff' && r.aboard === undefined) return 'not aboard'
  if (order.kind === 'work' && !isAt(r, order.workplace, size))
    return `too far: not at the ${order.name}`
  if (order.kind === 'tearDown' && !isAt(r, order.building, size))
    return `too far: not at the ${order.name}`
  if (order.kind === 'breed') {
    if (!isAt(r, order.stable, size)) return 'too far: not at the stable'
    if (r.order?.kind === 'breed') return 'already breeding'
  }
  if (order.kind === 'store' && carriedGoods(r.carried).length === 0) return 'carries nothing'
  return undefined
}

/**
 * Up to `n` distinct free tiles around `target`, nearest first: the target itself when it is
 * free, then outwards ring by ring, within `SPREAD_RADIUS`. Fewer when not enough are free.
 */
export function spreadTiles(
  target: { x: number; y: number },
  n: number,
  free: (x: number, y: number) => boolean,
  size: number,
): { x: number; y: number }[] {
  const tiles: { x: number; y: number; d: number }[] = []
  const radius = Math.min(SPREAD_RADIUS, Math.floor((size - 1) / 2))
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = wrap(target.x + dx, size)
      const y = wrap(target.y + dy, size)
      if (free(x, y)) tiles.push({ x, y, d: dx * dx + dy * dy })
    }
  }
  // Stable: tiles as far apart keep their row-by-row order.
  return tiles
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ x, y }) => ({ x, y }))
}

/** How far a resident stands from a tile, the short way round (squared, for sorting). */
function distance(r: { x: number; y: number }, t: { x: number; y: number }, size: number) {
  const dx = wrapDelta(r.x, t.x, size)
  const dy = wrapDelta(r.y, t.y, size)
  return dx * dx + dy * dy
}

/**
 * The requests a group order sends (ADR 0002: orders only request actions), one per resident
 * who can take it (`groupSkip`). A walk-to spreads the group over distinct free tiles around the
 * target: the resident nearest it gets the nearest tile, and so on; with too few free tiles the
 * rest are skipped. Work and Build make each join the workplace or site. A horse, a carriage or
 * a pair to breed goes to one of them only: the first on its tile takes it, and the rest are
 * skipped once none is left. Board fills the carriage's seats in the group's order and skips the
 * rest, the carriage being full.
 *
 * Queued (Shift held), each request is appended to the resident's queue instead (`CONTEXT.md`:
 * Queue), as their own card appends it: Work, Tear down and Breed after a walk to the place,
 * Store of whatever they carry by then. Orders that can't be a step are given as they are.
 */
export function groupRequests(
  order: GroupOrder,
  residents: readonly GroupResident[],
  {
    tick,
    size,
    free,
    queued = false,
    seen = {},
  }: {
    tick: number
    size: number
    free: (x: number, y: number) => boolean
    /** Shift held: append to each one's queue. */
    queued?: boolean
    seen?: GroupSeen
  },
): GroupSend {
  const skipped: Skipped[] = []
  const going: GroupResident[] = []
  const skip = (r: GroupResident, why: string) => skipped.push({ id: r.id, name: r.name, why })
  for (const r of residents) {
    const why = groupSkip(order, r, tick, size, queued, seen)
    if (why) skip(r, why)
    else going.push(r)
  }
  const requests: GroupSend['requests'] = []
  const params = 'params' in order && order.params ? { params: order.params } : {}
  const send = (r: GroupResident, o: OrderRequest) =>
    requests.push({ residentId: r.id, order: { ...o, residentId: r.id } })
  if (order.kind === 'walkTo') {
    const byDistance = [...going].sort(
      (a, b) => distance(a, order, size) - distance(b, order, size),
    )
    const tiles = spreadTiles(order, byDistance.length, free, size)
    byDistance.forEach((r, i) => {
      const tile = tiles[i]
      if (tile) send(r, { kind: 'walkTo', ...tile })
      else skip(r, 'no free tile near there')
    })
    return { requests: queued ? appended(requests, residents) : requests, skipped }
  }
  let seats = order.kind === 'board' ? order.seats : 0
  // Horses and carriages handed out so far: one each.
  const taken = new Set<string>()
  const take = (r: GroupResident, things: readonly { id: string; x: number; y: number }[]) => {
    const thing = onTile(r, things).find((t) => !taken.has(t.id))
    if (thing) taken.add(thing.id)
    return thing
  }
  for (const r of going) {
    switch (order.kind) {
      case 'board':
        // Queued, whether a seat is left is checked when the step's turn comes.
        if (!queued && seats-- <= 0) {
          skipped.push({ id: r.id, name: r.name, why: 'the carriage is full' })
          break
        }
        send(r, { kind: 'board', carriageId: order.carriage.id })
        break
      case 'getOff':
        send(r, { kind: 'getOff' })
        break
      case 'work':
        send(r, { kind: 'task', task: 'work', workplaceId: order.workplace.id, ...params })
        break
      case 'build':
        // The Build task walks there first and joins the site once one of them has laid it out.
        send(r, { kind: 'task', task: 'build', building: order.building, at: order.at, ...params })
        break
      case 'store': {
        // Everything they carry to the nearest storage; their own food stays in their hands.
        const goods = queued ? storeAll(r, tick).goods : carriedGoods(r.carried)
        send(r, { kind: 'store', goods, ...(order.to ? { to: order.to.id } : {}) })
        break
      }
      case 'fetch':
        send(r, {
          kind: 'fetch',
          goods: [order.good],
          ...(order.from ? { from: order.from.id } : {}),
        })
        break
      case 'drop': {
        const goods = Object.fromEntries(carriedGoods(r.carried).map((g) => [g, r.carried[g]]))
        send(r, { kind: 'drop', spot: { kind: 'ground' }, goods })
        break
      }
      case 'setDefenceScript':
        send(r, { kind: 'setDefenceScript', scriptId: order.scriptId, ...params })
        break
      case 'runScript':
        send(r, { kind: 'runScript', scriptId: order.scriptId, ...params })
        break
      case 'stop':
        send(r, { kind: 'stop' })
        break
      case 'setNumber': {
        const { name, value } = order
        const scriptId = r.script!.scriptId
        const set = value === null ? { targetId: null } : { value }
        send(r, { kind: 'setScriptParam', scriptId, name, ...set })
        break
      }
      case 'mount': {
        const horse = take(r, seen.horses ?? [])
        if (horse) send(r, { kind: 'mount', horseId: horse.id })
        else skip(r, 'no free horse left here')
        break
      }
      case 'dismount':
        send(r, { kind: 'dismount' })
        break
      case 'unhitch': {
        const carriage = take(
          r,
          (seen.carriages ?? []).filter((k) => k.horseId),
        )
        if (carriage) send(r, { kind: 'unhitch', carriageId: carriage.id })
        else skip(r, 'another of them unhitches the horse here')
        break
      }
      case 'drive':
      case 'haul': {
        const carriage = take(r, seen.carriages ?? [])
        if (!carriage) skip(r, 'another of them drives the carriage here')
        else if (order.kind === 'drive')
          send(r, { kind: 'drive', carriageId: carriage.id, x: order.x, y: order.y })
        else {
          // The Haul task: they run the Player's Haul (default) script (`CONTEXT.md`: Default script).
          const { x, y, goods, returnGoods, keepFood } = order
          const route = { x, y, goods, returnGoods, keepFood }
          send(r, { kind: 'task', task: 'haul', carriageId: carriage.id, ...route })
        }
        break
      }
      case 'feedStable':
        send(r, { kind: 'task', task: 'feedStable', stableId: stableOf(r, seen, size)!.id })
        break
      case 'line':
        send(r, { kind: order.line, from: order.from, to: order.to })
        break
      case 'tearDown':
        send(r, { kind: 'task', task: 'tearDown', buildingId: order.building.id })
        break
      case 'breed': {
        const breeder = requests[0] && residents.find((x) => x.id === requests[0]!.residentId)
        if (breeder) skip(r, `${breeder.name} breeds those two`)
        else {
          const { stable, horseIds } = order
          send(r, { kind: 'task', task: 'breed', stableId: stable.id, horseIds: [...horseIds] })
        }
        break
      }
      case 'attack':
        send(r, { kind: 'attack', targetId: order.targetId })
        break
      case 'climb':
        send(r, { kind: 'climb', wallId: order.wall.id })
        break
    }
  }
  // Setting a param is no step: it is given as it is, queued or not.
  if (!queued || order.kind === 'setNumber') return { requests, skipped }
  return { requests: appended(requests, residents, placeOf(order)), skipped }
}

/** The place a tile-bound order acts on, if it isn't where each of them stands. */
function placeOf(order: GroupOrder): { x: number; y: number } | undefined {
  if (order.kind === 'work') return order.workplace
  if (order.kind === 'tearDown') return order.building
  if (order.kind === 'breed') return order.stable
  if (order.kind === 'board') return order.carriage
  return undefined
}

/** The requests appended to each one's queue (`appendRequests`), acting at `at` if given. */
function appended(
  requests: GroupSend['requests'],
  residents: readonly GroupResident[],
  at?: { x: number; y: number },
): GroupSend['requests'] {
  const going = requests.map((q) => ({
    ...residents.find((r) => r.id === q.residentId)!,
    request: q.order,
  }))
  const orders = appendRequests(
    going,
    (r) => r.request,
    () => at && { x: at.x, y: at.y },
  )
  return requests.map((q, i) => ({ residentId: q.residentId, order: orders[i]! }))
}

/**
 * The number params the group card can set (`CONTEXT.md`: Script parameter): each one declared
 * by a script someone in the group runs, by name, with the scripts that declare it and its
 * default when they all declare the same one.
 */
export function groupNumberParams(
  residents: readonly { script?: { scriptId: number } }[],
  scripts: readonly Pick<ScriptSummary, 'id' | 'params'>[],
): { name: string; scriptIds: number[]; default?: number }[] {
  const running = new Set(residents.flatMap((r) => (r.script ? [r.script.scriptId] : [])))
  const byName = new Map<string, { scriptIds: number[]; defaults: (number | undefined)[] }>()
  for (const s of scripts) {
    if (!running.has(s.id)) continue
    for (const p of s.params) {
      if (p.type !== 'number') continue
      const seen = byName.get(p.name) ?? { scriptIds: [], defaults: [] }
      byName.set(p.name, {
        scriptIds: [...seen.scriptIds, s.id],
        defaults: [...seen.defaults, p.default],
      })
    }
  }
  return [...byName].map(([name, { scriptIds, defaults }]) => {
    const shared = defaults.every((d) => d === defaults[0]) ? defaults[0] : undefined
    return shared === undefined ? { name, scriptIds } : { name, scriptIds, default: shared }
  })
}

/** The line the group card shows once an order went out: how many it went to. */
export function groupSentLine(sent: number, of: number): string {
  if (sent === 0) return 'Nobody could take that order.'
  return sent === of ? `Sent to all ${of}.` : `Sent to ${sent} of ${of}.`
}

/** An order button on the group card's Orders tab. */
export type GroupButton =
  | 'walk'
  | 'stop'
  | 'mount'
  | 'dismount'
  | 'board'
  | 'getOff'
  | 'unhitch'
  | 'drive'
  | 'haul'
  | 'work'
  | 'feedStable'
  | 'build'
  | 'roadTo'
  | 'wallTo'
  | 'tearDown'
  | 'breed'
  | 'store'
  | 'storeAt'
  | 'fetch'
  | 'drop'
  | 'attack'
  | 'climb'
  | 'script'

/**
 * The group card's order buttons, in the order it shows them, under the same kinds as a
 * resident card's (ADR 0012). All of them always show: each goes to those who can take it. Board
 * shows once for each carriage of the realm some of them stand on, and greyed out with none.
 */
export const GROUP_BUTTONS: readonly { id: GroupButton; label: string; group: OrderGroup }[] = [
  { id: 'walk', label: 'Walk to', group: 'move' },
  { id: 'stop', label: 'Stop', group: 'move' },
  { id: 'mount', label: 'Mount horses', group: 'move' },
  { id: 'dismount', label: 'Dismount', group: 'move' },
  { id: 'board', label: 'Board carriage', group: 'move' },
  { id: 'getOff', label: 'Get off', group: 'move' },
  { id: 'unhitch', label: 'Unhitch horses', group: 'move' },
  { id: 'drive', label: 'Drive carriages to', group: 'move' },
  { id: 'haul', label: 'Haul route…', group: 'move' },
  { id: 'work', label: 'Work', group: 'work' },
  { id: 'feedStable', label: 'Feed the stable', group: 'work' },
  { id: 'build', label: 'Build', group: 'work' },
  { id: 'roadTo', label: 'Build road', group: 'work' },
  { id: 'wallTo', label: 'Build wall', group: 'work' },
  { id: 'tearDown', label: 'Tear down', group: 'work' },
  { id: 'breed', label: 'Breed horses…', group: 'work' },
  { id: 'store', label: 'Store', group: 'goods' },
  { id: 'storeAt', label: 'Store at…', group: 'goods' },
  { id: 'fetch', label: 'Fetch…', group: 'goods' },
  { id: 'drop', label: 'Drop all', group: 'goods' },
  { id: 'script', label: 'Run script…', group: 'scripts' },
  { id: 'attack', label: 'Attack', group: 'other' },
  { id: 'climb', label: 'Climb a wall', group: 'other' },
]

/** The resident card's own orders: every action it offers but the tile card's. */
export type ResidentOrderId = Exclude<ActionId, 'sendHere' | 'gate' | 'openCity' | 'renameCity'>

/**
 * For each order a resident card offers, the group card's buttons that give it (`CONTEXT.md`:
 * Group: every order a resident card offers is on the group card too), or why it can't go to a
 * group: orders about one resident in particular.
 */
export const GROUP_COUNTERPARTS: Record<
  ResidentOrderId,
  readonly GroupButton[] | { none: string }
> = {
  walk: ['walk'],
  stop: ['stop'],
  ride: ['mount', 'dismount'],
  board: ['board', 'getOff'],
  unhitch: ['unhitch'],
  drive: ['drive'],
  haul: ['haul'],
  work: ['work'],
  feedStable: ['feedStable'],
  build: ['build'],
  roadTo: ['roadTo'],
  wallTo: ['wallTo'],
  tearDown: ['tearDown'],
  breed: ['breed'],
  goods: ['store', 'storeAt', 'fetch', 'drop'],
  attack: ['attack'],
  walls: ['attack', 'climb'],
  script: ['script'],
  pair: { none: 'pairs two residents with each other' },
  makeLeader: { none: 'the realm has one Leader' },
  rename: { none: 'names one resident' },
}
