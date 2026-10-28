import { describe, expect, it } from 'vitest'
import { GOODS, QUEUE_DEFAULT_STEP_MINUTES, TICKS_PER_GAME_YEAR, type Stock } from '@csp/shared'
import { groupRequests, groupSentLine, spreadTiles, type GroupOrder } from './group-orders.js'

const TICK = 100 * TICKS_PER_GAME_YEAR
const SIZE = 64

const resident = (id: string, x: number, y: number, more: object = {}) => ({
  id,
  name: id.toUpperCase(),
  x,
  y,
  bornAt: TICK - 30 * TICKS_PER_GAME_YEAR,
  carried: {} as Stock,
  ...more,
})
const child = (id: string, x: number, y: number) => resident(id, x, y, { bornAt: TICK })
const carrying = (id: string, x: number, y: number) =>
  resident(id, x, y, { carrying: { partnerName: 'P', since: 0 } })

const everywhere = () => true
const send = (
  order: GroupOrder,
  rs: ReturnType<typeof resident>[],
  free: (x: number, y: number) => boolean = everywhere,
) => groupRequests(order, rs, { tick: TICK, size: SIZE, free })

describe('group orders', () => {
  it('spreads a walk-to over distinct free tiles around the target, nearest first', () => {
    // Water to the east of the target: those tiles aren't free.
    const free = (x: number) => x <= 10
    const rs = [
      resident('a', 0, 0),
      resident('b', 20, 20),
      resident('c', 9, 10),
      resident('d', 5, 5),
    ]
    const { requests, skipped } = send({ kind: 'walkTo', x: 10, y: 10 }, rs, free)
    expect(skipped).toEqual([])
    const tiles = requests.map((q) => `${q.order.x},${q.order.y}`)
    expect(new Set(tiles).size).toBe(4)
    for (const q of requests) {
      expect(q.order.kind).toBe('walkTo')
      expect(q.order.residentId).toBe(q.residentId)
      expect(free(q.order.x as number)).toBe(true)
      expect(Math.abs((q.order.x as number) - 10)).toBeLessThanOrEqual(1)
      expect(Math.abs((q.order.y as number) - 10)).toBeLessThanOrEqual(1)
    }
    // The one nearest the target gets the target itself.
    expect(requests.find((q) => q.residentId === 'c')!.order).toMatchObject({ x: 10, y: 10 })
  })

  it('finds tiles nearest first, the short way round the map', () => {
    const tiles = spreadTiles({ x: 0, y: 0 }, 5, everywhere, SIZE)
    expect(tiles[0]).toEqual({ x: 0, y: 0 })
    const rest = tiles.slice(1).map((t) => `${t.x},${t.y}`)
    expect(rest.sort()).toEqual(['0,1', '0,63', '1,0', '63,0'])
  })

  it('skips residents left over when too few tiles are free', () => {
    const free = (x: number, y: number) => x === 3 && y === 3
    const rs = [resident('a', 0, 0), resident('b', 3, 4)]
    const { requests, skipped } = send({ kind: 'walkTo', x: 3, y: 3 }, rs, free)
    expect(requests.map((q) => q.residentId)).toEqual(['b'])
    expect(skipped).toEqual([{ id: 'a', name: 'A', why: 'no free tile near there' }])
  })

  it('makes each who stands at the workplace work it, and says who is too far', () => {
    const farm = { id: 'farm', kind: 'farm' as const, x: 10, y: 10 }
    const rs = [
      resident('a', 10, 10),
      resident('b', 30, 30),
      child('c', 10, 10),
      carrying('d', 10, 10),
    ]
    const { requests, skipped } = send({ kind: 'work', workplace: farm, name: 'farm' }, rs)
    expect(requests).toEqual([
      {
        residentId: 'a',
        order: { kind: 'task', task: 'work', workplaceId: 'farm', residentId: 'a' },
      },
    ])
    expect(skipped).toEqual([
      { id: 'b', name: 'B', why: 'too far: not at the farm' },
      { id: 'c', name: 'C', why: 'a child' },
      { id: 'd', name: 'D', why: 'carrying a child' },
    ])
  })

  it('makes each walk to one site and build it, skipping children and those carrying a child', () => {
    const at = { x: 12, y: 12 }
    const rs = [resident('a', 0, 0), resident('b', 40, 40), child('c', 1, 1), carrying('d', 2, 2)]
    const { requests, skipped } = send({ kind: 'build', building: 'house', at }, rs)
    expect(requests.map((q) => q.order)).toEqual([
      { kind: 'task', task: 'build', building: 'house', at, residentId: 'a' },
      { kind: 'task', task: 'build', building: 'house', at, residentId: 'b' },
    ])
    expect(skipped.map((s) => [s.name, s.why])).toEqual([
      ['C', 'a child'],
      ['D', 'carrying a child'],
    ])
  })

  it('stores what each carries and skips those carrying nothing', () => {
    const rs = [resident('a', 0, 0, { carried: { wood: 3, food: 2 } }), resident('b', 0, 0)]
    const { requests, skipped } = send({ kind: 'store' }, rs)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.order).toMatchObject({ kind: 'store', residentId: 'a' })
    expect([...(requests[0]!.order.goods as string[])].sort()).toEqual(['food', 'wood'])
    expect(skipped).toEqual([{ id: 'b', name: 'B', why: 'carries nothing' }])
  })

  it('sends fetch, run script and stop to each; children walk, stop and run scripts', () => {
    const rs = [resident('a', 0, 0), child('c', 0, 0)]
    expect(send({ kind: 'fetch', good: 'wood' }, rs).skipped.map((s) => s.id)).toEqual(['c'])
    const script = send({ kind: 'runScript', scriptId: 7 }, rs)
    expect(script.skipped).toEqual([])
    expect(script.requests.map((q) => q.order)).toEqual([
      { kind: 'runScript', scriptId: 7, residentId: 'a' },
      { kind: 'runScript', scriptId: 7, residentId: 'c' },
    ])
    expect(send({ kind: 'stop' }, rs).requests).toHaveLength(2)
    expect(send({ kind: 'walkTo', x: 5, y: 5 }, rs).requests).toHaveLength(2)
  })

  it('says how many the order went to', () => {
    expect(groupSentLine(5, 5)).toBe('Sent to all 5.')
    expect(groupSentLine(3, 5)).toBe('Sent to 3 of 5.')
    expect(groupSentLine(0, 5)).toBe('Nobody could take that order.')
  })
})

describe('group orders with Shift held', () => {
  const queue = (
    order: GroupOrder,
    rs: ReturnType<typeof resident>[],
    free: (x: number, y: number) => boolean = everywhere,
  ) => groupRequests(order, rs, { tick: TICK, size: SIZE, free, queued: true })
  const farm = { id: 'farm', kind: 'farm' as const, x: 10, y: 10 }

  it("appends to each one's queue, or starts one", () => {
    const working = resident('b', 6, 6, {
      queue: {
        realmId: 'r1',
        steps: [{ id: 3, order: { kind: 'task', task: 'work', workplaceId: 'farm' } }],
        current: 0,
        startedAt: 0,
        loop: true,
        nextStepId: 4,
      },
    })
    const { requests } = queue({ kind: 'walkTo', x: 20, y: 20 }, [resident('a', 0, 0), working])
    const byId = Object.fromEntries(requests.map((q) => [q.residentId, q.order]))
    expect(byId.a).toMatchObject({
      kind: 'queue',
      residentId: 'a',
      steps: [{ order: { kind: 'walkTo' } }],
    })
    expect(byId.a!.steps).toHaveLength(1)
    // Their work keeps its id and gets a duration, now that a step follows it.
    expect(byId.b).toMatchObject({
      kind: 'editQueue',
      residentId: 'b',
      steps: [{ id: 3, minutes: QUEUE_DEFAULT_STEP_MINUTES }, { order: { kind: 'walkTo' } }],
    })
    // Each still gets their own tile around the target.
    const walks = requests.map((q) => (q.order.steps as { order: object }[]).at(-1)!.order)
    expect(new Set(walks.map((w) => JSON.stringify(w))).size).toBe(2)
  })

  it('queues work after a walk to the workplace, even for those away from it', () => {
    const rs = [resident('a', 10, 10), resident('b', 30, 30), child('c', 10, 10)]
    const { requests, skipped } = queue({ kind: 'work', workplace: farm, name: 'farm' }, rs)
    expect(requests.map((q) => [q.residentId, q.order.steps])).toEqual(
      ['a', 'b'].map((id) => [
        id,
        [
          { order: { kind: 'walkTo', x: 10, y: 10 } },
          { order: { kind: 'task', task: 'work', workplaceId: 'farm' } },
        ],
      ]),
    )
    expect(skipped).toEqual([{ id: 'c', name: 'C', why: 'a child' }])
  })

  it('queues storing everything, even for those carrying nothing yet', () => {
    const { requests, skipped } = queue({ kind: 'store' }, [resident('a', 0, 0)])
    expect(skipped).toEqual([])
    expect(requests[0]!.order.steps).toEqual([{ order: { kind: 'store', goods: [...GOODS] } }])
  })

  it('gives stop as it is: it is no step', () => {
    expect(queue({ kind: 'stop' }, [resident('a', 0, 0)]).requests).toEqual([
      { residentId: 'a', order: { kind: 'stop', residentId: 'a' } },
    ])
  })
})
