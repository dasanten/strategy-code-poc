import {
  CARRYING_A_CHILD,
  GOODS,
  boarderProblem,
  canHandle,
  canWork,
  isAt,
  wrap,
  wrapDelta,
  type Building,
  type BuildingKind,
  type Carriage,
  type Good,
  type OrderRequest,
  type Resident,
  type ScriptSummary,
  type StartParamValues,
  type Stock,
} from '@csp/shared'
import { appendRequests, storeAll } from './queue-view.js'

/**
 * One command for a group (`CONTEXT.md`: Group): the orders the group card offers, each sent to
 * every resident in it as the same order request a resident's own card sends.
 */
export type GroupOrder =
  | { kind: 'walkTo'; x: number; y: number }
  | ({ kind: 'work'; workplace: Pick<Building, 'id' | 'kind' | 'x' | 'y'>; name: string } & Starts)
  | ({ kind: 'build'; building: BuildingKind; at: { x: number; y: number } } & Starts)
  | { kind: 'store' }
  | { kind: 'fetch'; good: Good }
  | ({ kind: 'runScript'; scriptId: number } & Starts)
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
 * Why a resident of the group can't take the order, if they can't (`CONTEXT.md`: Child,
 * Carrying): children don't work or build, and fetch only Food; a partner carrying a child doesn't
 * work or build; Work is tile-bound, so only those standing at the workplace take it. Walking,
 * running a script and stopping go to everyone. Board goes to those who could board the carriage,
 * room aside (`boarderProblem`), Get off to those aboard one. Queued (Shift held), Work also goes
 * to those away from the workplace, who walk there first, Store to those carrying nothing yet, and
 * Board and Get off to everyone: whether they can is checked when the step's turn comes. A number
 * param goes to those running a script that has it.
 */
export function groupSkip(
  order: GroupOrder,
  r: GroupResident,
  tick: number,
  size: number,
  queued = false,
) {
  if (order.kind === 'setNumber')
    return r.script && order.scriptIds.includes(r.script.scriptId)
      ? undefined
      : `runs no script with ${order.name}`
  const tasks = ['work', 'build']
  if (tasks.includes(order.kind) && !canWork(r as Resident, tick)) return 'a child'
  if (order.kind === 'fetch' && !canHandle(r as Resident, tick, [order.good])) return 'a child'
  if ((order.kind === 'work' || order.kind === 'build') && r.carrying) return CARRYING_A_CHILD
  if (queued) return undefined
  if (order.kind === 'board') {
    const why = boarderProblem({ ...r, order: r.order ?? null }, order.carriage)
    return why === 'that carriage is not on the resident’s tile' ? 'not there' : why
  }
  if (order.kind === 'getOff' && r.aboard === undefined) return 'not aboard'
  if (order.kind === 'work' && !isAt(r, order.workplace, size))
    return `too far: not at the ${order.name}`
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
 * rest are skipped. Work and Build make each join the workplace or site. Board fills the
 * carriage's seats in the group's order and skips the rest, the carriage being full.
 *
 * Queued (Shift held), each request is appended to the resident's queue instead (`CONTEXT.md`:
 * Queue), as their own card appends it: Work after a walk to the workplace, Store of whatever
 * they carry by then. Stop, which can't be a step, is given as it is.
 */
export function groupRequests(
  order: GroupOrder,
  residents: readonly GroupResident[],
  {
    tick,
    size,
    free,
    queued = false,
  }: {
    tick: number
    size: number
    free: (x: number, y: number) => boolean
    /** Shift held: append to each one's queue. */
    queued?: boolean
  },
): GroupSend {
  const skipped: Skipped[] = []
  const going: GroupResident[] = []
  for (const r of residents) {
    const why = groupSkip(order, r, tick, size, queued)
    if (why) skipped.push({ id: r.id, name: r.name, why })
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
      else skipped.push({ id: r.id, name: r.name, why: 'no free tile near there' })
    })
    return { requests: queued ? appended(requests, residents) : requests, skipped }
  }
  let seats = order.kind === 'board' ? order.seats : 0
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
      case 'store':
        // Everything they carry to the nearest storage; their own food stays in their hands.
        send(r, {
          kind: 'store',
          goods: queued ? storeAll(r, tick).goods : carriedGoods(r.carried),
        })
        break
      case 'fetch':
        send(r, { kind: 'fetch', goods: [order.good] })
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
    }
  }
  // Setting a param is no step: it is given as it is, queued or not.
  if (!queued || order.kind === 'setNumber') return { requests, skipped }
  const at =
    order.kind === 'work' ? order.workplace : order.kind === 'board' ? order.carriage : undefined
  return { requests: appended(requests, residents, at), skipped }
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
