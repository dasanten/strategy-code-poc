import { BUILDABLE, MAX_WORKERS } from './shared/building.js'
import { covers } from './shared/footprint.js'
import type { Building, OrderRequest } from '@csp/shared-types'
import { appendRequest } from './queue-view.js'
import { groupRequests, type GroupOrder, type GroupSeen, type GroupSend } from './group-orders.js'

/**
 * Realm orders from a picked building's card (`CONTEXT.md`: Realm order): in realm control mode
 * the card of a building starts the orders about it, each ending in the who-list. Only the UI
 * (ADR 0041): what goes out is what the group card sends, but for one difference, Far residents
 * walk first (`realmRequests`).
 */

/** The orders a building's card starts in realm control mode, in the order it lists them. */
export type BuildingOrderId =
  'work' | 'buildSite' | 'tearDown' | 'feedStable' | 'breed' | 'teach' | 'train'

export const BUILDING_ORDER_LABELS: Record<BuildingOrderId, string> = {
  work: 'Work here',
  buildSite: 'Build this site',
  tearDown: 'Tear down',
  feedStable: 'Feed the stable',
  breed: 'Breed horses',
  teach: 'Teach',
  train: 'Train',
}

/** One of those orders on the card, greyed with why when it can't be given now (ADR 0019). */
export interface BuildingOrderRow {
  id: BuildingOrderId
  label: string
  reason?: string
}

/** The building as the card's realm orders need it. */
export type OrderedBuilding = Pick<Building, 'id' | 'kind' | 'x' | 'y'> &
  Partial<Pick<Building, 'site' | 'material'>>

/** Why a smithy's Work isn't given to several at once: each one picks what to make. */
export const SMITHY_WORK = 'pick what to make on each one’s card'
const NOT_FINISHED = 'not finished yet'
const TOO_FEW_HORSES = 'fewer than two of your horses in it'

/**
 * The realm orders a building's card offers (`CONTEXT.md`: Realm order): only those the group
 * card's order could apply to here, each greyed with why while it can't be given. Work at a
 * workplace or a site of one (`CONTEXT.md`: Working a site); Build at a site of the realm; Tear
 * down at a building of the realm or a workplace, which has no owner; Feed the stable and Breed
 * horses at a stable, Teach and Train at a training ground, once finished.
 */
export function buildingOrderRows(
  b: OrderedBuilding,
  {
    ours,
    horses,
  }: {
    /** In a city of the Player's realm. */
    ours: boolean
    /** How many of the realm's horses stand in it, for Breed horses. */
    horses: number
  },
): BuildingOrderRow[] {
  const rows: BuildingOrderRow[] = []
  const row = (id: BuildingOrderId, reason?: string) =>
    rows.push({ id, label: BUILDING_ORDER_LABELS[id], ...(reason ? { reason } : {}) })
  const workplace = b.kind !== 'road' && MAX_WORKERS[b.kind] !== undefined
  const unfinished = b.site ? NOT_FINISHED : undefined
  if (workplace) row('work', b.kind === 'smithy' ? SMITHY_WORK : undefined)
  if (b.site && ours) row('buildSite')
  if (b.kind === 'stable') {
    row('feedStable', unfinished)
    row('breed', unfinished ?? (horses < 2 ? TOO_FEW_HORSES : undefined))
  }
  if (b.kind === 'trainingGround') {
    row('teach', unfinished)
    row('train', unfinished)
  }
  // Last, away from the rest.
  if (BUILDABLE.includes(b.kind) && (ours || workplace)) row('tearDown')
  return rows
}

/** A group order a building's card gives (`buildingOrder`). */
export type BuildingGroupOrder = Extract<
  GroupOrder,
  { kind: 'work' | 'build' | 'tearDown' | 'feedStable' | 'breed' | 'teach' | 'train' }
>

/**
 * The group order a row of the building's card gives, as the group card would send it: the
 * building `name`d as the group card names it. Breed needs its pair and Teach its subject.
 */
export function buildingOrder(
  id: BuildingOrderId,
  b: OrderedBuilding,
  name: string,
  more: {
    horseIds?: [string, string]
    subject?: Extract<GroupOrder, { kind: 'teach' }>['subject']
  } = {},
): BuildingGroupOrder | undefined {
  const place = { id: b.id, kind: b.kind, x: b.x, y: b.y }
  switch (id) {
    case 'work':
      return { kind: 'work', workplace: place, name }
    case 'buildSite':
      return {
        kind: 'build',
        building: b.kind,
        at: { x: b.x, y: b.y },
        ...(b.material ? { material: b.material } : {}),
      }
    case 'tearDown':
      return { kind: 'tearDown', building: place, name }
    case 'feedStable':
      return { kind: 'feedStable' }
    case 'train':
      return { kind: 'train' }
    case 'breed':
      return more.horseIds && { kind: 'breed', stable: place, horseIds: more.horseIds }
    case 'teach':
      return more.subject && { kind: 'teach', subject: more.subject }
  }
}

/**
 * Orders bound to the target's tile (`CONTEXT.md`: Realm order): given only to those standing
 * there, so a realm order walks the others there first. Build walks there itself.
 */
const BOUND: readonly GroupOrder['kind'][] = [
  'work',
  'tearDown',
  'feedStable',
  'breed',
  'teach',
  'train',
]

/** Whether an order is bound to its target's tile, so those elsewhere walk there first. */
export const boundToTile = (order: GroupOrder) => BOUND.includes(order.kind)

type RealmResident = Parameters<typeof groupRequests>[1][number]

/**
 * Far residents walk first (`CONTEXT.md`: Realm order; ADR 0041): the requests a realm order
 * sends those ticked on its who-list. As the group card sends it (`groupRequests`), but for an
 * order bound to the target's tile a ticked resident who stands elsewhere gets a queue, a walk to
 * the target and then the order, instead of being skipped; one already there gets the plain
 * order. Those in `after` get the order appended to their queue (as Shift does on a card),
 * after a walk there unless their queue already ends there. One-to-a-place orders (one teacher per
 * ground, one breeder per pair) still go to the first of them only.
 */
export function realmRequests(
  order: GroupOrder,
  residents: readonly RealmResident[],
  {
    tick,
    size,
    free,
    seen = {},
    target,
    after = new Set(),
  }: {
    tick: number
    size: number
    free: (x: number, y: number) => boolean
    seen?: GroupSeen
    /** The building the order is about; its north-west tile is where those far off walk to. */
    target?: Pick<Building, 'kind' | 'x' | 'y'>
    /** Who of them gets it after what they do, not instead. */
    after?: ReadonlySet<string>
  },
): GroupSend {
  if (!target || !boundToTile(order)) {
    // Not bound to a tile: as the group card sends it, now or queued.
    const ctx = { tick, size, free, seen }
    const now = groupRequests(
      order,
      residents.filter((r) => !after.has(r.id)),
      ctx,
    )
    const later = groupRequests(
      order,
      residents.filter((r) => after.has(r.id)),
      { ...ctx, queued: true },
    )
    const byId = new Map([...now.requests, ...later.requests].map((q) => [q.residentId, q]))
    return {
      requests: residents.flatMap((r) => byId.get(r.id) ?? []),
      skipped: [...now.skipped, ...later.skipped],
    }
  }
  const at = { x: target.x, y: target.y }
  const there = (r: RealmResident) => covers(target, r.x, r.y, size)
  // Each one's request as if they stood there, all at once, so one-to-a-place still holds.
  const placed = residents.map((r) => (there(r) ? r : { ...r, x: at.x, y: at.y }))
  const { requests, skipped } = groupRequests(order, placed, { tick, size, free, seen })
  return {
    requests: requests.map(({ residentId, order: request }) => {
      const r = residents.find((x) => x.id === residentId)!
      return { residentId, order: walkFirst(r, request, at, after.has(r.id), there(r)) }
    }),
    skipped,
  }
}

/**
 * The order a resident gets for `request`, bound to the tile `at` (`realmRequests`): Now, the
 * plain request if they are there, else a new queue walking there and then doing it; After, the
 * request appended to their queue after a walk there (`appendRequest`).
 */
export function walkFirst(
  r: RealmResident,
  request: OrderRequest,
  at: { x: number; y: number },
  after: boolean,
  there: boolean,
): OrderRequest {
  if (after) return appendRequest(r, request, at) ?? request
  if (there) return request
  // A queue of their own with nothing before it: it replaces what they do.
  return appendRequest({ id: r.id, x: r.x, y: r.y }, request, at) ?? request
}
