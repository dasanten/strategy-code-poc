import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Building, OrderRequest, Resident, Stock } from '@csp/shared-types'
import {
  NO_SEAT_LEFT,
  NOT_DOCKED,
  driverStops,
  mostNote,
  onlyThis,
  standAt,
  vehicleMost,
  vehicleOrder,
  vehicleOrderRows,
  vehicleRequests,
  vehicleSuggests,
  type OrderedVehicle,
  type VehicleGroupOrder,
} from './vehicle-orders.js'
import { suggested, whoRows, whyNot, type WhoResident } from '../realm/who-list-view.js'

const TICK = 100 * TICKS_PER_GAME_YEAR
const SIZE = 64

const resident = (id: string, x: number, y: number, more: Partial<Resident> = {}) =>
  ({
    id,
    name: id.toUpperCase(),
    x,
    y,
    bornAt: TICK - 30 * TICKS_PER_GAME_YEAR,
    carried: {} as Stock,
    owner: 'r1',
    cityId: 'c1',
    ...more,
  }) as Resident
const child = { bornAt: TICK } as Partial<Resident>
const walking = {
  order: { kind: 'walkTo', target: { x: 0, y: 0 }, progress: 0 },
} as unknown as Partial<Resident>

const carriage = { id: 'k1', x: 10, y: 10, realmId: 'r1', cityId: 'c1' }
const cart = (
  more: Partial<Extract<OrderedVehicle, { what: 'carriage' }>> = {},
): OrderedVehicle => ({
  what: 'carriage',
  carriage,
  seats: 2,
  ...more,
})
const boat: OrderedVehicle = {
  what: 'vessel',
  vessel: { id: 'v1', x: 20, y: 20, kind: 'boat' },
  seats: 3,
}
const haven: Building = { id: 'hv', kind: 'haven', cityId: 'c1', x: 30, y: 30 }
const ship = (dockedAt?: string): OrderedVehicle => ({
  what: 'vessel',
  vessel: { id: 's1', x: 33, y: 30, kind: 'ship', ...(dockedAt ? { dockedAt } : {}) },
  seats: 5,
})

const ctx = { tick: TICK, size: SIZE, free: () => true, seen: { buildings: [haven] } }
const ids = (rows: { id: string; reason?: string }[]) =>
  rows.map((r) => (r.reason ? `${r.id} (${r.reason})` : r.id))
const haul = { goods: ['wood' as const], returnGoods: [], keepFood: 5 }

describe('the orders a carriage’s or vessel’s card starts', () => {
  it('offers Haul, Drive and Board on a carriage, Board greyed with no seat left', () => {
    expect(ids(vehicleOrderRows(cart()))).toEqual(['haul', 'drive', 'board'])
    expect(ids(vehicleOrderRows(cart({ seats: 0 })))).toEqual([
      'haul',
      'drive',
      `board (${NO_SEAT_LEFT})`,
    ])
  })

  it('greys Haul and Drive with no horse to pull it', () => {
    expect(ids(vehicleOrderRows(cart({ noHorse: 'no horse' })))).toEqual([
      'haul (no horse)',
      'drive (no horse)',
      'board',
    ])
  })

  it('says on Haul and Drive who drives it now, and that Now replaces them', () => {
    const rows = vehicleOrderRows(cart({ driver: { id: 'd', name: 'Ada' } }))
    expect(rows[0]?.note).toBe('Ada drives it: Now replaces them')
    expect(rows[1]?.note).toBe('Ada drives it: Now replaces them')
    expect(rows[2]?.note).toBe('2 seats left')
  })

  it('offers Row and Board on a boat, Board and Board as crew on a docked ship only', () => {
    expect(ids(vehicleOrderRows(boat))).toEqual(['row', 'boardBoat'])
    expect(ids(vehicleOrderRows(ship('hv')))).toEqual(['boardBoat', 'boardCrew'])
    expect(ids(vehicleOrderRows(ship()))).toEqual([
      `boardBoat (${NOT_DOCKED})`,
      `boardCrew (${NOT_DOCKED})`,
    ])
  })

  it('gives the group card’s orders, Haul and Drive only once their tile is picked', () => {
    expect(vehicleOrder('drive', cart())).toBeUndefined()
    expect(vehicleOrder('drive', cart(), { to: { x: 1, y: 2 } })).toEqual({
      kind: 'drive',
      x: 1,
      y: 2,
    })
    expect(vehicleOrder('haul', cart(), { to: { x: 1, y: 2 }, haul })).toEqual({
      kind: 'haul',
      x: 1,
      y: 2,
      ...haul,
    })
    expect(vehicleOrder('board', cart())).toEqual({ kind: 'board', carriage, seats: 2 })
    expect(vehicleOrder('boardCrew', ship('hv'))).toMatchObject({ kind: 'boardBoat', asCrew: true })
  })
})

describe('one driver, and Board up to the seats', () => {
  const drive: VehicleGroupOrder = { kind: 'drive', x: 0, y: 0 }
  const board: VehicleGroupOrder = { kind: 'board', carriage, seats: 2 }

  it('sends one driver or rower, as many boarders as seats, any number of crew', () => {
    expect(vehicleMost(drive)).toBe(1)
    expect(vehicleMost({ kind: 'row', x: 0, y: 0 })).toBe(1)
    expect(vehicleMost(board)).toBe(2)
    const crew = vehicleOrder('boardCrew', ship('hv'))!
    expect(vehicleMost(crew)).toBeUndefined()
    expect(vehicleSuggests(crew)).toBe(1)
    expect(vehicleSuggests(board)).toBe(2)
  })

  it('counts the seats on the list', () => {
    expect(mostNote(board, 1)).toBe('1 of 2 seats')
    expect(mostNote(board, 3)).toBe('3 of 2 seats: too many')
    expect(mostNote(drive, 1)).toBeUndefined()
    expect(mostNote(drive, 2)).toBe('One driver: tick only one.')
    expect(mostNote({ kind: 'row', x: 0, y: 0 }, 2)).toBe('One rower: tick only one.')
  })

  it('suggests the nearest idle one to drive, and as many as there are seats to board', () => {
    const own = [
      resident('a', 12, 10),
      resident('b', 11, 10),
      resident('c', 15, 10),
      resident('d', 10, 10, walking),
    ]
    const at = { x: 10, y: 10 }
    const way = () => undefined
    const seen = { ...ctx, seen: onlyThis(cart(), ctx.seen) }
    expect(suggested(whoRows(drive, own, at, way, seen), vehicleSuggests(drive))).toEqual(['b'])
    expect(suggested(whoRows(board, own, at, way, seen), vehicleSuggests(board))).toEqual([
      'b',
      'a',
    ])
  })

  it('lists a child as unable to drive, wherever they stand', () => {
    const kid = resident('k', 40, 40, child) as WhoResident
    const at = { x: 10, y: 10 }
    expect(whyNot(drive, kid, undefined, { ...ctx, seen: onlyThis(cart(), {}), at })).toBe(
      'a child',
    )
  })
})

describe('far residents walk first, to a carriage or vessel', () => {
  const at = { x: 10, y: 10 }

  it('queues a walk to the carriage, then the drive, for one elsewhere', () => {
    const far = resident('a', 2, 2)
    const { requests } = vehicleRequests({ kind: 'drive', x: 5, y: 5 }, cart(), [far], {
      ...ctx,
      at,
    })
    expect(requests).toEqual([
      {
        residentId: 'a',
        order: {
          kind: 'queue',
          residentId: 'a',
          steps: [
            { order: { kind: 'walkTo', x: 10, y: 10 } },
            { order: { kind: 'drive', carriageId: 'k1', x: 5, y: 5 } },
          ],
        },
      },
    ])
  })

  it('gives one on the carriage’s tile the plain order, and starts the haul route', () => {
    const near = resident('a', 10, 10)
    const order = vehicleOrder('haul', cart(), { to: { x: 5, y: 5 }, haul })!
    const { requests } = vehicleRequests(order, cart(), [near], { ...ctx, at })
    expect(requests[0]?.order).toMatchObject({
      kind: 'task',
      task: 'haul',
      carriageId: 'k1',
      x: 5,
      y: 5,
      goods: ['wood'],
      residentId: 'a',
    })
  })

  it('takes only this carriage, not another standing on its tile', () => {
    const near = resident('a', 10, 10)
    const seen = { ...ctx.seen, carriages: [{ id: 'other', x: 10, y: 10 }] }
    const { requests } = vehicleRequests({ kind: 'drive', x: 5, y: 5 }, cart(), [near], {
      ...ctx,
      seen,
      at,
    })
    expect(requests[0]?.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
  })

  it('boards no more than the seats, the rest skipped as the carriage is full', () => {
    const own = [resident('a', 1, 1), resident('b', 10, 10), resident('c', 3, 3)]
    const { requests, skipped } = vehicleRequests(
      { kind: 'board', carriage, seats: 2 },
      cart(),
      own,
      { ...ctx, at },
    )
    expect(requests.map((q) => q.residentId)).toEqual(['a', 'b'])
    expect(requests[1]?.order).toEqual({ kind: 'board', carriageId: 'k1', residentId: 'b' })
    expect(skipped).toEqual([{ id: 'c', name: 'C', why: 'the carriage is full' }])
  })

  it('stops the driver first when the new one takes it Now, not with After', () => {
    const v = cart({ driver: { id: 'd', name: 'D' } })
    const near = resident('a', 10, 10)
    const now = vehicleRequests({ kind: 'drive', x: 5, y: 5 }, v, [near], { ...ctx, at })
    expect(now.stop).toBe('d')
    expect(now.requests.map((q) => q.order.kind)).toEqual(['drive'])
    const busy = resident('a', 10, 10, walking)
    const later = vehicleRequests({ kind: 'drive', x: 5, y: 5 }, v, [busy], {
      ...ctx,
      at,
      after: new Set(['a']),
    })
    expect(later.stop).toBeUndefined()
    expect(later.requests.map((q) => q.residentId)).toEqual(['a'])
  })

  it('does not stop the driver when they are the one given the order', () => {
    const v = cart({ driver: { id: 'd', name: 'D' } })
    expect(driverStops(v, { kind: 'drive', x: 0, y: 0 }, [{ id: 'd' }], new Set())).toBeUndefined()
    expect(driverStops(v, { kind: 'board', carriage, seats: 2 }, [{ id: 'a' }], new Set())).toBe(
      undefined,
    )
  })

  it('walks one beside the boat first, then rows it', () => {
    const stand = standAt(boat, { size: SIZE, standable: (x, y) => x === 19 && y === 20 })
    expect(stand).toEqual({ x: 19, y: 20 })
    const far = resident('a', 2, 2)
    const { requests } = vehicleRequests({ kind: 'row', x: 25, y: 20 }, boat, [far], {
      ...ctx,
      at: stand!,
    })
    expect(requests[0]?.order).toEqual({
      kind: 'queue',
      residentId: 'a',
      steps: [
        { order: { kind: 'walkTo', x: 19, y: 20 } },
        { order: { kind: 'row', vesselId: 'v1', x: 25, y: 20 } },
      ],
    })
  })

  it('rows at once for one already beside the boat', () => {
    const beside = resident('a', 19, 20)
    const { requests } = vehicleRequests({ kind: 'row', x: 25, y: 20 }, boat, [beside], {
      ...ctx,
      at: { x: 19, y: 20 },
    })
    expect(requests[0]?.order).toEqual({
      kind: 'row',
      vesselId: 'v1',
      x: 25,
      y: 20,
      residentId: 'a',
    })
  })

  it('walks to the haven a ship is docked at, then boards as crew', () => {
    const v = ship('hv')
    const stand = standAt(v, { size: SIZE, standable: () => true, buildings: [haven] })
    expect(stand).toEqual({ x: 30, y: 30 })
    const far = resident('a', 2, 2)
    const order = vehicleOrder('boardCrew', v)!
    const { requests } = vehicleRequests(order, v, [far], { ...ctx, at: stand! })
    const steps = (requests[0]?.order as OrderRequest & { steps: unknown[] }).steps
    expect(steps).toEqual([
      { order: { kind: 'walkTo', x: 30, y: 30 } },
      { order: { kind: 'board', vesselId: 's1', asCrew: true } },
    ])
  })

  it('finds no place to stand beside a boat with no land around it, nor by a ship at sea', () => {
    expect(standAt(boat, { size: SIZE, standable: () => false })).toBeUndefined()
    expect(standAt(ship(), { size: SIZE, standable: () => true, buildings: [haven] })).toBe(
      undefined,
    )
  })
})
