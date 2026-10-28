import {
  CARRYING_A_CHILD,
  GOODS,
  canWork,
  isAt,
  wrap,
  wrapDelta,
  type Building,
  type BuildingKind,
  type Good,
  type OrderRequest,
  type Resident,
  type Stock,
} from '@csp/shared'
import { appendRequests } from './queue-view.js'

/**
 * One command for a group (`CONTEXT.md`: Group): the orders the group card offers, each sent to
 * every resident in it as the same order request a resident's own card sends.
 */
export type GroupOrder =
  | { kind: 'walkTo'; x: number; y: number }
  | { kind: 'work'; workplace: Pick<Building, 'id' | 'kind' | 'x' | 'y'>; name: string }
  | { kind: 'build'; building: BuildingKind; at: { x: number; y: number } }
  | { kind: 'store' }
  | { kind: 'fetch'; good: Good }
  | { kind: 'runScript'; scriptId: number }
  | { kind: 'stop' }

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

type GroupResident = Pick<Resident, 'id' | 'name' | 'x' | 'y' | 'bornAt' | 'carried'> &
  Partial<Pick<Resident, 'carrying' | 'order' | 'script' | 'queue'>>

/** The goods carried, at least one unit of each. */
const carriedGoods = (stock: Stock): Good[] => GOODS.filter((g) => (stock[g] ?? 0) > 0)

/**
 * Why a resident of the group can't take the order, if they can't (`CONTEXT.md`: Child,
 * Carrying): children don't work, build, store or fetch; a partner carrying a child doesn't work
 * or build; Work is tile-bound, so only those standing at the workplace take it. Walking, running
 * a script and stopping go to everyone. Queued (Shift held), Work also goes to those away from
 * the workplace, who walk there first, and Store to those carrying nothing yet.
 */
export function groupSkip(
  order: GroupOrder,
  r: GroupResident,
  tick: number,
  size: number,
  queued = false,
) {
  const tasks = ['work', 'build', 'store', 'fetch']
  if (tasks.includes(order.kind) && !canWork(r as Resident, tick)) return 'a child'
  if ((order.kind === 'work' || order.kind === 'build') && r.carrying) return CARRYING_A_CHILD
  if (queued) return undefined
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
 * rest are skipped. Work and Build make each join the workplace or site.
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
  for (const r of going) {
    switch (order.kind) {
      case 'work':
        send(r, { kind: 'task', task: 'work', workplaceId: order.workplace.id })
        break
      case 'build':
        // The Build task walks there first and joins the site once one of them has laid it out.
        send(r, { kind: 'task', task: 'build', building: order.building, at: order.at })
        break
      case 'store':
        // Everything they carry to the nearest storage; their own food stays in their hands.
        send(r, { kind: 'store', goods: queued ? [...GOODS] : carriedGoods(r.carried) })
        break
      case 'fetch':
        send(r, { kind: 'fetch', goods: [order.good] })
        break
      case 'runScript':
        send(r, { kind: 'runScript', scriptId: order.scriptId })
        break
      case 'stop':
        send(r, { kind: 'stop' })
        break
    }
  }
  if (!queued) return { requests, skipped }
  const at = order.kind === 'work' ? order.workplace : undefined
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

/** The line the group card shows once an order went out: how many it went to. */
export function groupSentLine(sent: number, of: number): string {
  if (sent === 0) return 'Nobody could take that order.'
  return sent === of ? `Sent to all ${of}.` : `Sent to ${sent} of ${of}.`
}
