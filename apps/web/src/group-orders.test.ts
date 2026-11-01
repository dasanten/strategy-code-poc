import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  GOODS,
  QUEUE_DEFAULT_STEP_MINUTES,
  TICKS_PER_GAME_YEAR,
  type Building,
  type Stock,
} from '@csp/shared'
import {
  GROUP_BUTTONS,
  GROUP_COUNTERPARTS,
  groupNumberParams,
  groupRequests,
  groupSentLine,
  spreadTiles,
  type GroupOrder,
  type GroupSeen,
  type ResidentOrderId,
} from './group-orders.js'
import { GroupCard } from './Residents.js'
import { ORDER_GROUP_LABELS, residentActions, type ResidentHere } from './selection-view.js'

const TICK = 100 * TICKS_PER_GAME_YEAR
const SIZE = 64

const resident = (id: string, x: number, y: number, more: object = {}) => ({
  id,
  name: id.toUpperCase(),
  x,
  y,
  bornAt: TICK - 30 * TICKS_PER_GAME_YEAR,
  carried: {} as Stock,
  owner: 'r1' as string | null,
  cityId: null as string | null,
  ...more,
})
const child = (id: string, x: number, y: number) => resident(id, x, y, { bornAt: TICK })
const carrying = (id: string, x: number, y: number) =>
  resident(id, x, y, { carrying: { partnerName: 'P', since: 0 } })

/** Carriage k1 of realm r1 at (4, 4). */
const k1 = { id: 'k1', x: 4, y: 4, realmId: 'r1', cityId: null }

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

  it('lets children store and fetch Food, and only Food', () => {
    const rs = [resident('a', 0, 0), resident('c', 0, 0, { bornAt: TICK, carried: { food: 4 } })]
    expect(send({ kind: 'fetch', good: 'food' }, rs).requests.map((q) => q.order)).toEqual([
      { kind: 'fetch', goods: ['food'], residentId: 'a' },
      { kind: 'fetch', goods: ['food'], residentId: 'c' },
    ])
    expect(send({ kind: 'store' }, rs).requests.map((q) => q.order)).toEqual([
      { kind: 'store', goods: ['food'], residentId: 'c' },
    ])
    const queued = groupRequests({ kind: 'store' }, rs, {
      tick: TICK,
      size: SIZE,
      free: everywhere,
      queued: true,
    }).requests.map((q) => q.order.steps)
    expect(queued).toEqual([
      [{ order: { kind: 'store', goods: [...GOODS] } }],
      [{ order: { kind: 'store', goods: ['food'] } }],
    ])
  })

  it('sends fetch, run script and stop to each; children walk, stop and run scripts', () => {
    const rs = [resident('a', 0, 0), child('c', 0, 0)]
    expect(send({ kind: 'fetch', good: 'wood' }, rs).skipped).toEqual([
      { id: 'c', name: 'C', why: 'a child' },
    ])
    const script = send({ kind: 'runScript', scriptId: 7 }, rs)
    expect(script.skipped).toEqual([])
    expect(script.requests.map((q) => q.order)).toEqual([
      { kind: 'runScript', scriptId: 7, residentId: 'a' },
      { kind: 'runScript', scriptId: 7, residentId: 'c' },
    ])
    expect(send({ kind: 'stop' }, rs).requests).toHaveLength(2)
    expect(send({ kind: 'walkTo', x: 5, y: 5 }, rs).requests).toHaveLength(2)
  })

  it('sets a number param for each running a script that has it, queued or not', () => {
    const rs = [
      resident('a', 0, 0, { script: { scriptId: 3 } }),
      resident('b', 0, 0, { script: { scriptId: 4 } }),
      resident('c', 0, 0),
    ]
    const order: GroupOrder = { kind: 'setNumber', name: 'foodAt', value: 4, scriptIds: [3] }
    const { requests, skipped } = send(order, rs)
    expect(requests.map((q) => q.order)).toEqual([
      { kind: 'setScriptParam', scriptId: 3, name: 'foodAt', value: 4, residentId: 'a' },
    ])
    expect(skipped.map((s) => [s.id, s.why])).toEqual([
      ['b', 'runs no script with foodAt'],
      ['c', 'runs no script with foodAt'],
    ])
    const queued = groupRequests(order, rs, {
      tick: TICK,
      size: SIZE,
      free: everywhere,
      queued: true,
    })
    expect(queued.requests).toEqual(requests)
    const clear = send({ ...order, value: null }, rs).requests.map((q) => q.order)
    expect(clear).toEqual([
      { kind: 'setScriptParam', scriptId: 3, name: 'foodAt', targetId: null, residentId: 'a' },
    ])
  })

  it('offers the number params of the scripts the group runs', () => {
    const scripts = [
      { id: 3, params: [{ name: 'foodAt', type: 'number' as const }] },
      {
        id: 4,
        params: [
          { name: 'foodAt', type: 'number' as const },
          { name: 'storage', type: 'storage' as const },
        ],
      },
      { id: 5, params: [{ name: 'other', type: 'number' as const }] },
    ]
    const rs = [{ script: { scriptId: 3 } }, { script: { scriptId: 4 } }, {}]
    expect(groupNumberParams(rs, scripts)).toEqual([{ name: 'foodAt', scriptIds: [3, 4] }])
  })

  it('boards those on the carriage until it is full, and says who was skipped and why', () => {
    const rs = [
      resident('a', 4, 4),
      resident('away', 5, 4),
      child('b', 4, 4),
      resident('aboard', 4, 4, { aboard: 'k1' }),
      resident('driver', 4, 4, { order: { kind: 'drive', carriageId: 'k1' } }),
      resident('c', 4, 4),
      resident('d', 4, 4),
    ]
    const { requests, skipped } = send({ kind: 'board', carriage: k1, seats: 2 }, rs)
    // Children ride along too.
    expect(requests).toEqual([
      { residentId: 'a', order: { kind: 'board', carriageId: 'k1', residentId: 'a' } },
      { residentId: 'b', order: { kind: 'board', carriageId: 'k1', residentId: 'b' } },
    ])
    expect(skipped).toEqual([
      { id: 'away', name: 'AWAY', why: 'not there' },
      { id: 'aboard', name: 'ABOARD', why: 'already aboard that carriage' },
      { id: 'driver', name: 'DRIVER', why: 'the driver can’t board' },
      { id: 'c', name: 'C', why: 'the carriage is full' },
      { id: 'd', name: 'D', why: 'the carriage is full' },
    ])
  })

  it('gets those aboard off and skips the others', () => {
    const rs = [resident('a', 4, 4, { aboard: 'k1' }), resident('b', 4, 4)]
    const { requests, skipped } = send({ kind: 'getOff' }, rs)
    expect(requests).toEqual([{ residentId: 'a', order: { kind: 'getOff', residentId: 'a' } }])
    expect(skipped).toEqual([{ id: 'b', name: 'B', why: 'not aboard' }])
  })

  it('shows a number param’s default only when every script declares the same one', () => {
    const foodAt = (d?: number) => ({
      name: 'foodAt',
      type: 'number' as const,
      ...(d === undefined ? {} : { default: d }),
    })
    const rs = [{ script: { scriptId: 3 } }, { script: { scriptId: 4 } }]
    const with3 = (other?: number) => [
      { id: 3, params: [foodAt(3)] },
      { id: 4, params: [foodAt(other)] },
    ]
    expect(groupNumberParams(rs, with3(3))).toEqual([
      { name: 'foodAt', scriptIds: [3, 4], default: 3 },
    ])
    expect(groupNumberParams(rs, with3(5))).toEqual([{ name: 'foodAt', scriptIds: [3, 4] }])
    expect(groupNumberParams(rs, with3())).toEqual([{ name: 'foodAt', scriptIds: [3, 4] }])
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

  it('gives each the params set before the script starts, a queued step keeping them', () => {
    const params = { foodAt: 2, storage: null }
    const rs = [resident('a', 10, 10), resident('b', 10, 10)]
    const run = send({ kind: 'runScript', scriptId: 7, params }, rs)
    expect(run.requests.map((q) => q.order)).toEqual([
      { kind: 'runScript', scriptId: 7, params, residentId: 'a' },
      { kind: 'runScript', scriptId: 7, params, residentId: 'b' },
    ])
    const { requests } = queue({ kind: 'work', workplace: farm, name: 'farm', params }, rs)
    for (const q of requests)
      expect(q.order.steps).toContainEqual({
        order: { kind: 'task', task: 'work', workplaceId: 'farm', params },
      })
  })

  it('picks the defence script for each, children too, with the params picked for it', () => {
    const rs = [resident('a', 0, 0), child('c', 0, 0)]
    const params = { foodAt: 2 }
    const picked = send({ kind: 'setDefenceScript', scriptId: 7, params }, rs)
    expect(picked.skipped).toEqual([])
    expect(picked.requests.map((q) => q.order)).toEqual([
      { kind: 'setDefenceScript', scriptId: 7, params, residentId: 'a' },
      { kind: 'setDefenceScript', scriptId: 7, params, residentId: 'c' },
    ])
    expect(send({ kind: 'setDefenceScript', scriptId: null }, rs).requests[0]!.order).toEqual({
      kind: 'setDefenceScript',
      scriptId: null,
      residentId: 'a',
    })
  })

  it('queues storing everything, even for those carrying nothing yet', () => {
    const { requests, skipped } = queue({ kind: 'store' }, [resident('a', 0, 0)])
    expect(skipped).toEqual([])
    expect(requests[0]!.order.steps).toEqual([{ order: { kind: 'store', goods: [...GOODS] } }])
  })

  it('queues boarding after a walk to the carriage, and getting off, for everyone', () => {
    const rs = [resident('a', 4, 4), resident('b', 30, 30)]
    const board = queue({ kind: 'board', carriage: k1, seats: 0 }, rs)
    expect(board.skipped).toEqual([])
    expect(board.requests.map((q) => [q.residentId, q.order.steps])).toEqual(
      ['a', 'b'].map((id) => [
        id,
        [{ order: { kind: 'walkTo', x: 4, y: 4 } }, { order: { kind: 'board', carriageId: 'k1' } }],
      ]),
    )
    const getOff = queue({ kind: 'getOff' }, rs)
    expect(getOff.skipped).toEqual([])
    expect(getOff.requests[1]!.order.steps).toEqual([{ order: { kind: 'getOff' } }])
  })

  it('gives stop as it is: it is no step', () => {
    expect(queue({ kind: 'stop' }, [resident('a', 0, 0)]).requests).toEqual([
      { residentId: 'a', order: { kind: 'stop', residentId: 'a' } },
    ])
  })
})

describe('every resident order on the group card', () => {
  const farm: Building = { id: 'farm', kind: 'farm', cityId: null, x: 5, y: 5 }
  const stable: Building = { id: 'stable', kind: 'stable', cityId: null, x: 5, y: 5 }
  const ground: Building = { id: 'ground', kind: 'trainingGround', cityId: null, x: 5, y: 5 }
  const carriage = { id: 'k1', realmId: 'me', cityId: null, x: 5, y: 5, horseId: null, load: {} }
  /** An adult with everything about them, so their card offers every order it has. */
  const everything = (building: Building): ResidentHere => ({
    adult: true,
    busy: true,
    inCity: true,
    carriage,
    building,
    othersInSight: 1,
    wallsInSight: 1,
    picking: false,
    makeLeader: { problem: undefined },
    relocate: { problem: undefined },
    renamable: true,
    horseToRide: true,
    carries: true,
    carriageToBoard: true,
    carriageToUnhitch: true,
  })
  const offered = [
    ...residentActions(everything(farm)),
    ...residentActions({ ...everything(stable), horseToRide: false, riding: true }),
    ...residentActions(everything(ground)),
  ].map((a) => a.id)

  it('has a counterpart on the group card for each, or says why it goes to one resident only', () => {
    expect(new Set(offered)).toEqual(new Set(Object.keys(GROUP_COUNTERPARTS)))
    const buttons = new Set(GROUP_BUTTONS.map((b) => b.id))
    for (const id of offered) {
      const counterpart = GROUP_COUNTERPARTS[id as ResidentOrderId]
      if ('none' in counterpart) continue
      expect(counterpart.length, id).toBeGreaterThan(0)
      for (const b of counterpart) expect(buttons.has(b), `${id}: ${b}`).toBe(true)
    }
    const oneOnly = Object.entries(GROUP_COUNTERPARTS).filter(([, c]) => 'none' in c)
    expect(oneOnly.map(([id]) => id).sort()).toEqual(['makeLeader', 'pair', 'relocate', 'rename'])
  })

  it('shows every one of its buttons on the Orders tab, under the resident card’s kinds', () => {
    const html = renderToStaticMarkup(
      createElement(GroupCard, {
        residents: [],
        scripts: [],
        buildings: [],
        picking: false,
        onPicking: () => {},
        buildAt: undefined,
        onOrder: () => {},
        report: undefined,
        orderError: undefined,
        onPick: () => {},
        onClose: () => {},
      }),
    )
    for (const b of GROUP_BUTTONS) expect(html).toContain(`>${b.label}</button>`)
    for (const g of new Set(GROUP_BUTTONS.map((b) => b.group)))
      expect(html).toContain(`<h3>${ORDER_GROUP_LABELS[g].replace('&', '&amp;')}</h3>`)
  })
})

describe('the group card’s other orders', () => {
  const seenSend = (order: GroupOrder, rs: ReturnType<typeof resident>[], seen: GroupSeen) =>
    groupRequests(order, rs, { tick: TICK, size: SIZE, free: everywhere, seen })
  const orders = (s: { requests: { order: object }[] }) => s.requests.map((q) => q.order)
  const why = (s: { skipped: { id: string; why: string }[] }) => s.skipped.map((x) => [x.id, x.why])

  it('mounts each on a different free horse on their tile, and dismounts those riding', () => {
    const horses = [
      { id: 'h1', x: 5, y: 5 },
      { id: 'h2', x: 5, y: 5 },
      { id: 'h3', x: 9, y: 9 },
    ]
    const rs = [
      resident('a', 5, 5),
      resident('b', 5, 5),
      resident('c', 5, 5),
      resident('d', 0, 0),
      resident('e', 5, 5, { riding: 'h9' }),
    ]
    const mount = seenSend({ kind: 'mount' }, rs, { horses })
    expect(orders(mount)).toEqual([
      { kind: 'mount', horseId: 'h1', residentId: 'a' },
      { kind: 'mount', horseId: 'h2', residentId: 'b' },
    ])
    expect(why(mount)).toEqual([
      ['d', 'no free horse here'],
      ['e', 'already riding'],
      ['c', 'no free horse left here'],
    ])
    const off = seenSend({ kind: 'dismount' }, rs, {})
    expect(orders(off)).toEqual([{ kind: 'dismount', residentId: 'e' }])
    expect(why(off)).toHaveLength(4)
  })

  it('unhitches a different hitched carriage each, skipping children and those without one', () => {
    const carriages = [
      { id: 'k1', x: 5, y: 5, horseId: 'h1' },
      { id: 'k2', x: 5, y: 5, horseId: null },
      { id: 'k3', x: 9, y: 9, horseId: 'h3' },
    ]
    const rs = [resident('a', 5, 5), resident('b', 5, 5), child('c', 9, 9), resident('d', 0, 0)]
    const sent = seenSend({ kind: 'unhitch' }, rs, { carriages })
    expect(orders(sent)).toEqual([{ kind: 'unhitch', carriageId: 'k1', residentId: 'a' }])
    expect(why(sent)).toEqual([
      ['c', 'a child'],
      ['d', 'no hitched horse here'],
      ['b', 'another of them unhitches the horse here'],
    ])
  })

  it('makes each standing in a stable feed it; children and those elsewhere are skipped', () => {
    const buildings = [
      { id: 's1', kind: 'stable' as const, x: 10, y: 10 },
      { id: 's2', kind: 'stable' as const, x: 20, y: 20, site: { work: 0, delivered: {} } },
    ]
    const rs = [
      resident('a', 10, 10),
      resident('b', 11, 11),
      child('c', 10, 10),
      resident('d', 20, 20),
      resident('e', 0, 0),
    ]
    const feed = seenSend({ kind: 'feedStable' }, rs, { buildings })
    expect(orders(feed)).toEqual([
      { kind: 'task', task: 'feedStable', stableId: 's1', residentId: 'a' },
      { kind: 'task', task: 'feedStable', stableId: 's1', residentId: 'b' },
    ])
    expect(why(feed)).toEqual([
      ['c', 'a child'],
      ['d', 'not at a stable'],
      ['e', 'not at a stable'],
    ])
  })

  it('makes the first on each training ground teach there and the rest of them train', () => {
    const site = { work: 0, delivered: {} }
    const buildings = [
      { id: 'g1', kind: 'trainingGround' as const, x: 10, y: 10 },
      { id: 'g2', kind: 'trainingGround' as const, x: 20, y: 20 },
      { id: 'g3', kind: 'trainingGround' as const, x: 30, y: 30, site },
    ]
    const rs = [
      resident('a', 10, 10),
      resident('b', 11, 11),
      child('c', 10, 10),
      resident('d', 20, 20),
      resident('e', 30, 30),
    ]
    const teach = seenSend({ kind: 'teach', subject: 'strength' }, rs, { buildings })
    expect(orders(teach)).toEqual([
      { kind: 'teach', buildingId: 'g1', subject: 'strength', residentId: 'a' },
      { kind: 'teach', buildingId: 'g2', subject: 'strength', residentId: 'd' },
    ])
    expect(why(teach)).toEqual([
      ['c', 'a child'],
      ['e', 'not at a training ground'],
      ['b', 'A teaches there'],
    ])
    const train = seenSend({ kind: 'train' }, rs, { buildings })
    expect(train.requests.map((q) => q.residentId)).toEqual(['a', 'b', 'd'])
    expect(why(train)).toEqual([
      ['c', 'a child'],
      ['e', 'not at a training ground'],
    ])
  })

  it('drives and hauls with a different carriage each; riders don’t drive', () => {
    const carriages = [{ id: 'k1', x: 5, y: 5 }]
    const rs = [
      resident('a', 5, 5),
      resident('b', 5, 5),
      resident('c', 0, 0),
      resident('d', 5, 5, { riding: 'h1' }),
      child('e', 5, 5),
    ]
    const drive = seenSend({ kind: 'drive', x: 30, y: 30 }, rs, { carriages })
    expect(orders(drive)).toEqual([
      { kind: 'drive', carriageId: 'k1', x: 30, y: 30, residentId: 'a' },
    ])
    expect(why(drive)).toEqual([
      ['c', 'no carriage here'],
      ['d', 'dismount first to drive'],
      ['e', 'a child'],
      ['b', 'another of them drives the carriage here'],
    ])
    const route = { x: 30, y: 30, goods: ['wood' as const], returnGoods: [], keepFood: 2 }
    const haul = seenSend({ kind: 'haul', ...route }, [carrying('f', 5, 5), ...rs], { carriages })
    expect(orders(haul)).toEqual([
      { kind: 'task', task: 'haul', carriageId: 'k1', ...route, residentId: 'a' },
    ])
    expect(why(haul)[0]).toEqual(['f', 'carrying a child'])
  })

  it('builds road or wall along one line, the same for each adult', () => {
    const line = { from: { x: 1, y: 1 }, to: { x: 5, y: 1 } }
    const rs = [resident('a', 0, 0), resident('b', 9, 9), child('c', 0, 0), carrying('d', 0, 0)]
    const road = send({ kind: 'line', line: 'roadLine', ...line }, rs)
    expect(orders(road)).toEqual([
      { kind: 'roadLine', ...line, residentId: 'a' },
      { kind: 'roadLine', ...line, residentId: 'b' },
    ])
    expect(why(road)).toEqual([
      ['c', 'a child'],
      ['d', 'carrying a child'],
    ])
    expect(orders(send({ kind: 'line', line: 'wallLine', ...line }, rs))[0]).toMatchObject({
      kind: 'wallLine',
    })
  })

  it('tears down with those standing at the building, queued with the rest too', () => {
    const house = { id: 'house', kind: 'house' as const, x: 10, y: 10 }
    const rs = [resident('a', 10, 10), resident('b', 30, 30)]
    const order: GroupOrder = { kind: 'tearDown', building: house, name: 'house' }
    const now = send(order, rs)
    expect(orders(now)).toEqual([
      { kind: 'task', task: 'tearDown', buildingId: 'house', residentId: 'a' },
    ])
    expect(why(now)).toEqual([['b', 'too far: not at the house']])
    const queued = groupRequests(order, rs, {
      tick: TICK,
      size: SIZE,
      free: everywhere,
      queued: true,
    })
    expect(queued.requests.map((q) => q.order.steps)).toEqual(
      ['a', 'b'].map(() => [
        { order: { kind: 'walkTo', x: 10, y: 10 } },
        { order: { kind: 'task', task: 'tearDown', buildingId: 'house' } },
      ]),
    )
  })

  it('gives a pair of horses to breed to one standing at the stable who isn’t breeding yet', () => {
    const stable = { id: 's1', kind: 'stable' as const, x: 10, y: 10 }
    const breeding = {
      kind: 'breed',
      stableId: 's1',
      horseIds: ['h8', 'h9'],
      at: { x: 10, y: 10 },
      progress: 0,
    }
    const rs = [
      resident('a', 10, 10, { order: breeding }),
      resident('b', 10, 10),
      resident('c', 10, 10),
      resident('d', 0, 0),
      carrying('e', 10, 10),
    ]
    const breed = send({ kind: 'breed', stable, horseIds: ['h1', 'h2'] }, rs)
    expect(orders(breed)).toEqual([
      { kind: 'task', task: 'breed', stableId: 's1', horseIds: ['h1', 'h2'], residentId: 'b' },
    ])
    expect(why(breed)).toEqual([
      ['a', 'already breeding'],
      ['d', 'too far: not at the stable'],
      ['e', 'carrying a child'],
      ['c', 'B breeds those two'],
    ])
  })

  it('stores at and fetches from the place picked, and drops everything carried', () => {
    const rs = [resident('a', 0, 0, { carried: { wood: 3 } }), resident('b', 0, 0)]
    const at = { id: 'st1', name: 'storage' }
    expect(orders(send({ kind: 'store', to: at }, rs))).toEqual([
      { kind: 'store', goods: ['wood'], to: 'st1', residentId: 'a' },
    ])
    expect(orders(send({ kind: 'fetch', good: 'stone', from: at }, rs))).toEqual([
      { kind: 'fetch', goods: ['stone'], from: 'st1', residentId: 'a' },
      { kind: 'fetch', goods: ['stone'], from: 'st1', residentId: 'b' },
    ])
    // A child puts down only Food (`CONTEXT.md`: Child).
    const kids = [
      resident('c', 0, 0, { bornAt: TICK, carried: { wood: 1 } }),
      resident('d', 0, 0, { bornAt: TICK, carried: { food: 2 } }),
    ]
    const drop = send({ kind: 'drop' }, [...rs, ...kids])
    expect(orders(drop)).toEqual([
      { kind: 'drop', spot: { kind: 'ground' }, goods: { wood: 3 }, residentId: 'a' },
      { kind: 'drop', spot: { kind: 'ground' }, goods: { food: 2 }, residentId: 'd' },
    ])
    expect(why(drop)).toEqual([
      ['b', 'carries nothing'],
      ['c', 'a child'],
    ])
  })

  it('attacks one target with all of them, and climbs with those next to the wall', () => {
    const rs = [resident('a', 4, 5), resident('b', 9, 9), child('c', 5, 6)]
    expect(orders(send({ kind: 'attack', targetId: 'x1' }, rs))).toHaveLength(3)
    const wall = { id: 'w1', x: 5, y: 5 }
    const climb = send({ kind: 'climb', wall }, rs)
    expect(orders(climb)).toEqual([
      { kind: 'climb', wallId: 'w1', residentId: 'a' },
      { kind: 'climb', wallId: 'w1', residentId: 'c' },
    ])
    expect(why(climb)).toEqual([['b', 'not next to the wall']])
  })
})
