import { besideVessel } from './shared/vessels.js'
import { inContact } from './shared/combat.js'
import { wrap } from './shared/terrain.js'
import type { Building, Carriage, OrderRequest, SeenVessel, VesselKind } from '@csp/shared-types'
import { appendRequest } from './queue-view.js'
import { timedItems, type PlanItem } from './plan-blocks.js'
import { groupRequests, type GroupOrder, type GroupSeen, type GroupSend } from './group-orders.js'
import type { HaulSetup } from './Residents.js'

/**
 * Realm orders from the card of a carriage or vessel of the realm (`CONTEXT.md`: Realm order): in
 * realm control mode a carriage's card starts Haul with this carriage, Drive this to and Board, a
 * boat's Row this to and Board, a docked ship's Board as a passenger or as crew, each ending in
 * the who-list. Only the UI (ADR 0041): what goes out is what the group card sends, with Far
 * residents walk first (`vehicleRequests`) as for a building's orders.
 */

/** The orders a carriage's or vessel's card starts in realm control mode. */
export type VehicleOrderId = 'haul' | 'drive' | 'board' | 'row' | 'boardBoat' | 'boardCrew'

export const VEHICLE_ORDER_LABELS: Record<VehicleOrderId, string> = {
  haul: 'Haul with this carriage',
  drive: 'Drive this to',
  board: 'Board',
  row: 'Row this to',
  boardBoat: 'Board',
  boardCrew: 'Board as crew',
}

/** One of those orders on the card, greyed with why when it can't be given now (ADR 0019). */
export interface VehicleOrderRow {
  id: VehicleOrderId
  label: string
  /** Why it can't be given now; the row is greyed. */
  reason?: string
  /** What the Player should know before giving it, such as who drives it now. */
  note?: string
}

/** Someone of the realm by name, at a carriage's reins or a boat's oars. */
export interface NamedOne {
  id: string
  name: string
}

/** A carriage or vessel of the realm as its card's realm orders need it. */
export type OrderedVehicle =
  | {
      what: 'carriage'
      carriage: Pick<Carriage, 'id' | 'x' | 'y' | 'realmId' | 'cityId'>
      /** Passenger seats left (`seatsLeft`). */
      seats: number
      /** Who drives it now, if anyone does. */
      driver?: NamedOne
      /** Why no horse can pull it, if none can: with none, it can't be driven or haul. */
      noHorse?: string
    }
  | {
      what: 'vessel'
      vessel: Pick<SeenVessel, 'id' | 'x' | 'y'> & { kind: VesselKind; dockedAt?: string }
      /** Passenger seats left (`vesselRoom`). */
      seats: number
      /** Who rows it now, if anyone does (a boat). */
      rower?: NamedOne
    }

/** Why Board is greyed on a full carriage or vessel. */
export const NO_SEAT_LEFT = 'no seat left'
/** Why a boat's orders are greyed with no land beside it to stand on (`standAt`). */
export const NO_STAND = 'no land beside it to stand on'
/** Why a ship at sea offers no Board: it is boarded only at the haven it is docked at. */
export const NOT_DOCKED = 'not docked at a haven'

/** "1 seat left", "3 seats left". */
export function seatsLine(seats: number): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'} left`
}

/**
 * The realm orders the card of a carriage or vessel of the realm offers (`CONTEXT.md`: Realm
 * order): for a carriage Haul with this carriage, Drive this to and Board; for a boat Row this to
 * and Board; for a ship Board and Board as crew. Driving and hauling need a horse to pull it;
 * Board a seat left, a ship being docked. A carriage someone drives says so on its Haul and Drive
 * rows: the order replaces them only for a resident who takes it Now (`driverStops`).
 */
export function vehicleOrderRows(v: OrderedVehicle): VehicleOrderRow[] {
  const rows: VehicleOrderRow[] = []
  const row = (id: VehicleOrderId, reason?: string, note?: string) =>
    rows.push({
      id,
      label: VEHICLE_ORDER_LABELS[id],
      ...(reason ? { reason } : {}),
      ...(note && !reason ? { note } : {}),
    })
  const seats = v.seats > 0 ? undefined : NO_SEAT_LEFT
  if (v.what === 'carriage') {
    const driven = v.driver && `${v.driver.name} drives it: Now replaces them`
    row('haul', v.noHorse, driven)
    row('drive', v.noHorse, driven)
    row('board', seats, seatsLine(v.seats))
    return rows
  }
  if (v.vessel.kind === 'ship') {
    const docked = v.vessel.dockedAt === undefined ? NOT_DOCKED : undefined
    row('boardBoat', docked ?? seats, seatsLine(v.seats))
    row('boardCrew', docked)
    return rows
  }
  row('row', undefined, v.rower && `${v.rower.name} rows it`)
  row('boardBoat', seats, seatsLine(v.seats))
  return rows
}

/** A group order a carriage's or vessel's card gives (`vehicleOrder`). */
export type VehicleGroupOrder = Extract<
  GroupOrder,
  { kind: 'haul' | 'drive' | 'board' | 'row' | 'boardBoat' }
>

/**
 * The group order a row of the card gives, as the group card would send it. Haul needs its
 * route (`HaulSetup` and the other stop), Drive and Row the tile picked; Board the seats left.
 */
export function vehicleOrder(
  id: VehicleOrderId,
  v: OrderedVehicle,
  more: { to?: { x: number; y: number }; haul?: HaulSetup } = {},
): VehicleGroupOrder | undefined {
  if (v.what === 'carriage') {
    switch (id) {
      case 'haul':
        return more.to && more.haul && { kind: 'haul', ...more.to, ...more.haul }
      case 'drive':
        return more.to && { kind: 'drive', ...more.to }
      case 'board':
        return { kind: 'board', carriage: v.carriage, seats: v.seats }
      default:
        return undefined
    }
  }
  switch (id) {
    case 'row':
      return more.to && { kind: 'row', ...more.to }
    case 'boardBoat':
      return { kind: 'boardBoat', vessel: v.vessel, seats: v.seats }
    case 'boardCrew':
      return { kind: 'boardBoat', vessel: v.vessel, seats: v.seats, asCrew: true }
    default:
      return undefined
  }
}

/** The rows that ask for a tile on the map before the who-list: where to drive, row or haul. */
export const PICKS_A_TILE: readonly VehicleOrderId[] = ['haul', 'drive', 'row']

/**
 * How many the who-list may send (`CONTEXT.md`: Who-list): one driver or rower, as many
 * boarders as there are seats left, any number of crew. It also ticks that many of the nearest
 * idle ones, one for crew (`vehicleSuggests`).
 */
export function vehicleMost(order: VehicleGroupOrder): number | undefined {
  switch (order.kind) {
    case 'haul':
    case 'drive':
    case 'row':
      return 1
    case 'board':
      return order.seats
    case 'boardBoat':
      return order.asCrew ? undefined : order.seats
  }
}

/** How many of the nearest idle residents the who-list ticks for a carriage's or vessel's order. */
export function vehicleSuggests(order: VehicleGroupOrder): number {
  return vehicleMost(order) ?? 1
}

/**
 * What the who-list says of the ticks against the most it may send (`vehicleMost`): "2 of 4
 * seats", "one driver: tick only one"; undefined with no limit.
 */
export function mostNote(order: VehicleGroupOrder, ticked: number): string | undefined {
  const most = vehicleMost(order)
  if (most === undefined) return undefined
  if (order.kind === 'board' || order.kind === 'boardBoat')
    return `${ticked} of ${most} ${most === 1 ? 'seat' : 'seats'}${ticked > most ? ': too many' : ''}`
  const who = order.kind === 'row' ? 'rower' : 'driver'
  return ticked > 1 ? `One ${who}: tick only one.` : undefined
}

/** Whether Confirm is on: someone ticked, and no more than the order may send. */
export function vehicleConfirmable(order: VehicleGroupOrder, ticked: number): boolean {
  const most = vehicleMost(order)
  return ticked > 0 && (most === undefined || ticked <= most)
}

/** What a vessel's beside needs to know of the havens a ship docks at. */
type Havens = readonly Pick<Building, 'id' | 'kind' | 'x' | 'y'>[]

/** The eight tiles around a tile, the straight ones first, as the beside tiles to stand on. */
const AROUND = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const

/**
 * Where the one taking an order about it stands (`CONTEXT.md`: Beside a vessel, Docked): a
 * carriage's own tile; for a boat, the first tile around it a resident can stand on
 * (`standable`); for a docked ship, its haven. Undefined when there is none: a boat with no land
 * beside it, a ship at sea.
 */
export function standAt(
  v: OrderedVehicle,
  {
    size,
    standable,
    buildings = [],
  }: { size: number; standable: (x: number, y: number) => boolean; buildings?: Havens },
): { x: number; y: number } | undefined {
  if (v.what === 'carriage') return { x: v.carriage.x, y: v.carriage.y }
  const { vessel } = v
  if (vessel.kind === 'ship') {
    const haven = buildings.find((b) => b.id === vessel.dockedAt)
    return haven && { x: haven.x, y: haven.y }
  }
  for (const [dx, dy] of AROUND) {
    const x = wrap(vessel.x + dx, size)
    const y = wrap(vessel.y + dy, size)
    if (standable(x, y) && inContact(size, vessel, { x, y })) return { x, y }
  }
  return undefined
}

/**
 * What a group order sees with this carriage or vessel the only one to take, whatever else
 * stands there: the who-list judges by it, and `vehicleRequests` sends by it.
 */
export function onlyThis(v: OrderedVehicle, seen: GroupSeen): GroupSeen {
  return v.what === 'carriage'
    ? { ...seen, carriages: [{ ...v.carriage }] }
    : { ...seen, vessels: [{ ...v.vessel }] }
}

type VehicleResident = Parameters<typeof groupRequests>[1][number]

/**
 * Whether a resident already stands where the order about the carriage or vessel is taken: on
 * the carriage's tile; aboard the vessel or beside it, a ship's at its haven.
 */
export function standsThere(
  v: OrderedVehicle,
  r: Pick<VehicleResident, 'x' | 'y' | 'aboard'>,
  size: number,
  buildings: Havens = [],
): boolean {
  if (v.what === 'carriage') return r.x === v.carriage.x && r.y === v.carriage.y
  return r.aboard === v.vessel.id || besideVessel(v.vessel, r, size, buildings)
}

/**
 * Who drives it now and is replaced (`CONTEXT.md`: Realm order): a carriage's driver, when the
 * order to drive or haul goes Now to someone else. With After, they keep it until the new one's
 * turn comes.
 */
export function driverStops(
  v: OrderedVehicle,
  order: VehicleGroupOrder,
  to: readonly { id: string }[],
  after: ReadonlySet<string>,
): string | undefined {
  if (v.what !== 'carriage' || !v.driver) return undefined
  if (order.kind !== 'drive' && order.kind !== 'haul') return undefined
  const now = to.filter((r) => !after.has(r.id))
  return now.length > 0 && !now.some((r) => r.id === v.driver!.id) ? v.driver.id : undefined
}

/**
 * Far residents walk first, for a carriage or vessel (`CONTEXT.md`: Realm order; ADR 0041): the
 * requests a realm order from its card sends those ticked on its who-list. As the group card
 * sends it (`groupRequests`), with this carriage or vessel only, but a ticked resident who stands
 * elsewhere gets a queue, a walk to `at` (`standAt`) and then the order, instead of being
 * skipped. Those in `after` get it appended to their queue, after a walk there. Board still stops
 * at the seats and Drive, Haul and Row at one each. A carriage's driver replaced Now
 * (`driverStops`) is to be stopped first, so the carriage is free for the new one: `stop`.
 */
export function vehicleRequests(
  order: VehicleGroupOrder,
  v: OrderedVehicle,
  residents: readonly VehicleResident[],
  {
    tick,
    size,
    free,
    seen = {},
    at,
    after = new Set(),
  }: {
    tick: number
    size: number
    free: (x: number, y: number) => boolean
    seen?: GroupSeen
    /** Where those far off walk to (`standAt`). */
    at: { x: number; y: number }
    after?: ReadonlySet<string>
  },
): GroupSend & { stop?: string } {
  const buildings = seen.buildings ?? []
  const there = (r: VehicleResident) => standsThere(v, r, size, buildings)
  const only = onlyThis(v, seen)
  // Each one's request as if they stood there, all at once, so the seats and one driver hold.
  const placed = residents.map((r) => (there(r) ? r : { ...r, x: at.x, y: at.y }))
  const { requests, skipped } = groupRequests(order, placed, { tick, size, free, seen: only })
  const stop = driverStops(
    v,
    order,
    requests.map((q) => ({ id: q.residentId })),
    after,
  )
  return {
    requests: requests.map(({ residentId, order: request }) => {
      const r = residents.find((x) => x.id === residentId)!
      return { residentId, order: walkThere(r, request, at, after.has(r.id), there(r)) }
    }),
    skipped,
    ...(stop ? { stop } : {}),
  }
}

/**
 * The order a resident gets for `request` about the carriage or vessel taken at `at`: Now, the
 * plain request if they are there, else a new queue walking there and then doing it; After, the
 * request appended to their queue after a walk there. A row is no order on its own tile
 * (`appendRequest` puts no walk before it), so its walk is put in here.
 */
export function walkThere(
  r: VehicleResident,
  request: OrderRequest,
  at: { x: number; y: number },
  after: boolean,
  there: boolean,
): OrderRequest {
  if (!after && there) return request
  // A queue of their own with nothing before it: it replaces what they do.
  const base = after ? r : { id: r.id, x: r.x, y: r.y }
  if (request.kind !== 'row') return appendRequest(base, request, at) ?? request
  const walked = there ? undefined : appendRequest(base, { kind: 'walkTo', ...at }, at)
  const step = { ...request }
  delete step.residentId
  if (walked && (walked.kind === 'queue' || walked.kind === 'editQueue'))
    return { ...walked, steps: timedItems([...(walked.steps as PlanItem[]), { order: step }]) }
  return appendRequest(base, request, at) ?? request
}
