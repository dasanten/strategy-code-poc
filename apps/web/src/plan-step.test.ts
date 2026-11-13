import { GOODS } from './shared/world.js'
import { QUEUE_STEP_KINDS, queueSteps, queueStepsProblem, stepLine } from './shared/queue.js'
import { freeHousing } from './shared/city.js'
import type { Building, Condition, Queue, QueueStepRequest } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  PLAN_STEPS,
  PLAN_TASKS,
  horsesIn,
  nextPick,
  pickCity,
  pickInto,
  pickPlace,
  planAsk,
  planCities,
  planHorses,
  planOrder,
  planPickAt,
  type Plan,
  type PlanAnswer,
  type PlanAsk,
  type PlanWorld,
} from './plan-step.js'
import { appendRequest, stepLabel, type Queued } from './queue-view.js'
import { NEW_DRAFT, conditionLabel, conditionOf } from './condition-view.js'

/** Add step (`CONTEXT.md`: Queue, Planning ahead): steps planned on other tiles. */

const farm: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 20, y: 20 }
const storage: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 6, stock: {} }
const stable: Building = { id: 'b1', kind: 'stable', cityId: 'c1', x: 30, y: 4 }
const theirs: Building = { id: 's2', kind: 'storage', cityId: 'c2', x: 40, y: 40, stock: {} }
const site: Building = {
  id: 'm1',
  kind: 'mine',
  cityId: null,
  x: 50,
  y: 9,
  site: { delivered: {}, work: 0 },
}
/** Out of sight, as last seen: realm r2's mine, its house and a quarry site. */
const theirMine: Building = { id: 'm2', kind: 'mine', cityId: 'c2', x: 44, y: 30 }
const theirHouse: Building = { id: 'h2', kind: 'house', cityId: 'c2', x: 46, y: 30 }
const farSite: Building = { ...site, id: 'q1', kind: 'quarry', x: 48, y: 30 }
const w: PlanWorld = {
  buildings: [farm, storage, stable, theirs, site],
  lastSeen: [theirMine, theirHouse, farSite],
  carriages: [{ id: 'k1', x: 3, y: 3, realmId: 'r1' }],
  horses: [
    { id: 'h1', x: 30, y: 4, realmId: 'r1' },
    { id: 'h2', x: 30, y: 4, realmId: 'r1' },
    { id: 'h9', x: 5, y: 5, realmId: 'r2' },
  ],
  cities: [
    { id: 'c1', realmId: 'r1' },
    { id: 'c2', realmId: 'r2' },
  ],
  realmId: 'r1',
  size: 64,
}
/** A resident in the city, at (9, 3), doing nothing. */
const inCity: Queued = { id: 'w1', x: 9, y: 3, order: null }

/** The plan for `kind` with these taps picked into it, one after another. */
function planned(kind: Plan['kind'], ...taps: [number, number][]): Plan {
  return taps.reduce<Plan>((p, [x, y]) => pickInto(w, p, { x, y }), { kind, picked: [] })
}

/** The queue the server keeps for a queue or edit-queue order. */
function kept(steps: QueueStepRequest[]): Queue {
  return {
    realmId: 'r1',
    items: steps.map((s, i) => ({
      ...s,
      id: s.id ?? i + 1,
    })),
    current: 0,
    startedAt: 0,
    loop: false,
    nextStepId: steps.length + 1,
  }
}

describe('Add step', () => {
  it('offers every kind of step a queue holds', () => {
    const answers: Record<PlanAsk, PlanAnswer> = {
      goods: { ask: 'goods', goods: { wood: 1 } },
      buildingKind: { ask: 'buildingKind', building: 'farm' },
      makes: { ask: 'makes', makes: 'spear' },
      horses: { ask: 'horses', horseIds: ['h1', 'h2'] },
      horse: { ask: 'horse', horseId: 'h1' },
      haul: { ask: 'haul', setup: { goods: ['wood'], returnGoods: [], keepFood: 0 } },
      script: { ask: 'script', scriptId: 1 },
      subject: { ask: 'subject', subject: 'strength' },
      units: { ask: 'units', units: 2 },
      condition: { ask: 'condition', condition: { kind: 'mounted', is: true } },
    }
    const kinds = new Set(
      PLAN_STEPS.map((k) => {
        const picked = k.picks.map(() => ({
          x: 0,
          y: 0,
          id: 'x',
          spot: { kind: 'ground' as const },
        }))
        const plan: Plan = { kind: k.id, picked }
        const ask = planAsk(plan)
        return planOrder(plan, ask && answers[ask])!.order.kind
      }),
    )
    // Working, building, tearing down, hauling and lines are planned as tasks, as the card gives them.
    const asTasks = ['build', 'tearDown', 'workAt', 'haul', 'roadLine', 'wallLine']
    expect([...kinds].sort()).toEqual(QUEUE_STEP_KINDS.filter((k) => !asTasks.includes(k)).sort())
  })

  it('offers Customise on exactly the steps that give a task, with that task', () => {
    const answers: Partial<Record<PlanAsk, PlanAnswer>> = {
      goods: { ask: 'goods', goods: { wood: 1 } },
      buildingKind: { ask: 'buildingKind', building: 'farm' },
      horses: { ask: 'horses', horseIds: ['h1', 'h2'] },
      horse: { ask: 'horse', horseId: 'h1' },
      haul: { ask: 'haul', setup: { goods: ['wood'], returnGoods: [], keepFood: 0 } },
      script: { ask: 'script', scriptId: 1 },
      subject: { ask: 'subject', subject: 'strength' },
      units: { ask: 'units', units: 2 },
      condition: { ask: 'condition', condition: { kind: 'mounted', is: true } },
    }
    for (const k of PLAN_STEPS) {
      const picked = k.picks.map(() => ({ x: 0, y: 0, id: 'x', spot: { kind: 'ground' as const } }))
      const plan: Plan = { kind: k.id, picked }
      const ask = planAsk(plan)
      const { order } = planOrder(plan, ask && answers[ask])!
      expect([k.id, PLAN_TASKS[k.id]]).toEqual([
        k.id,
        order.kind === 'task' ? order.task : undefined,
      ])
    }
  })

  it('plans a Build line from its two picked ends, with no walk before it', () => {
    const plan = planned('wall', [30, 10], [34, 14])
    expect(nextPick(plan)).toBeUndefined()
    expect(planAsk(plan)).toBeUndefined()
    const { order, at } = planOrder(plan)!
    expect(at).toBeUndefined()
    const line = { building: 'wall', from: { x: 30, y: 10 }, to: { x: 34, y: 14 } }
    expect(order).toEqual({ kind: 'task', task: 'buildLine', ...line })
    expect(stepLine(order)).toEqual(line)
    const request = appendRequest(inCity, order, at)!
    expect(request.steps).toEqual([{ order }])
    expect(queueStepsProblem(request.steps)).toBeUndefined()
    // Ending on its own, it may go before other steps without a duration.
    expect(queueStepsProblem([{ order }, { order: { kind: 'walkTo', x: 1, y: 1 } }])).toBe(
      undefined,
    )
  })

  it('puts a walk to a workplace elsewhere before working it', () => {
    const plan = planned('work', [20, 20])
    expect(nextPick(plan)).toBeUndefined()
    expect(planAsk(plan)).toBeUndefined()
    const { order, at } = planOrder(plan)!
    const request = appendRequest(inCity, order, at)!
    expect(request).toEqual({
      kind: 'queue',
      residentId: 'w1',
      steps: [
        { order: { kind: 'walkTo', x: 20, y: 20 } },
        { order: { kind: 'task', task: 'work', workplaceId: 'f1' } },
      ],
    })
    expect(queueStepsProblem(request.steps)).toBeUndefined()
  })

  it('plans walk → work a far farm → store at a storage', () => {
    let r = inCity
    for (const plan of [
      planned('walk', [20, 20]),
      planned('work', [20, 20]),
      planned('store', [12, 6]),
    ]) {
      const { order, at } = planOrder(plan)!
      const request = appendRequest(r, order, at)!
      r = { ...r, queue: kept(request.steps as QueueStepRequest[]) }
    }
    expect(queueSteps(r.queue!.items).map((s) => s.order)).toEqual([
      { kind: 'walkTo', x: 20, y: 20 },
      { kind: 'task', task: 'work', workplaceId: 'f1' },
      { kind: 'store', goods: [...GOODS], to: 's1' },
    ])
    // The work gets a duration once a step follows it.
    expect(queueSteps(r.queue!.items)[1]!.minutes).toBeGreaterThan(0)
  })

  it('picks only what could make sense, and says why not', () => {
    expect(planned('work', [9, 9])).toMatchObject({ picked: [], error: 'no workplace there' })
    expect(planned('work', [9, 9], [20, 20]).picked).toHaveLength(1)
    expect(planPickAt(w, 'building', { x: 40, y: 40 })).toBe(
      'no building of yours, workplace or site there',
    )
    // Anyone's storage takes goods; a carriage must be the realm's.
    expect(planPickAt(w, 'storage', { x: 40, y: 40 })).toMatchObject({ id: 's2' })
    expect(planPickAt(w, 'storage', { x: 3, y: 3 })).toMatchObject({ id: 'k1' })
    expect(planPickAt(w, 'horse', { x: 5, y: 5 })).toBe('no horse of yours there')
    expect(planPickAt(w, 'spot', { x: 12, y: 6 })).toMatchObject({
      spot: { kind: 'storage', storageId: 's1' },
    })
    expect(planPickAt(w, 'spot', { x: 1, y: 1 })).toMatchObject({ spot: { kind: 'ground' } })
  })

  it('picks a workplace or site anyone may work as last seen, whoever built it', () => {
    expect(planOrder(planned('work', [44, 30]))).toEqual({
      order: { kind: 'task', task: 'work', workplaceId: 'm2' },
      at: { x: 44, y: 30 },
    })
    expect(planPickAt(w, 'building', { x: 44, y: 30 })).toMatchObject({ id: 'm2' })
    expect(planPickAt(w, 'building', { x: 48, y: 30 })).toMatchObject({ id: 'q1' })
    // Any other building must be the realm's own.
    expect(planPickAt(w, 'building', { x: 46, y: 30 })).toBe(
      'no building of yours, workplace or site there',
    )
    // A site to join is built as what it was last seen as.
    expect(planOrder(planned('build', [48, 30]))?.order).toMatchObject({ building: 'quarry' })
  })

  it('picks a workplace still being built for Work, which builds it first', () => {
    // `CONTEXT.md`: Working a site.
    expect(planOrder(planned('work', [50, 9]))).toEqual({
      order: { kind: 'task', task: 'work', workplaceId: 'm1' },
      at: { x: 50, y: 9 },
    })
    expect(planOrder(planned('work', [48, 30]))?.order).toMatchObject({ workplaceId: 'q1' })
  })

  it('asks for what more a step needs once its places are picked', () => {
    expect(planAsk(planned('fetch', [12, 6]))).toBe('goods')
    expect(planAsk(planned('build', [9, 9]))).toBe('buildingKind')
    // A site to join is built as what it is.
    const join = planned('build', [50, 9])
    expect(planAsk(join)).toBeUndefined()
    expect(planOrder(join)!.order).toEqual({
      kind: 'task',
      task: 'build',
      building: 'mine',
      at: { x: 50, y: 9 },
    })
    expect(planAsk(planned('runScript'))).toBe('script')
    expect(planAsk(planned('haul', [3, 3]))).toBeUndefined()
    expect(planAsk(planned('haul', [3, 3], [20, 20]))).toBe('haul')
  })

  it('drives and mounts from where the carriage or horse is', () => {
    const drive = planOrder(planned('drive', [3, 3], [20, 20]))!
    expect(drive).toEqual({
      order: { kind: 'drive', carriageId: 'k1', x: 20, y: 20 },
      at: { x: 3, y: 3 },
    })
    const request = appendRequest(inCity, drive.order, drive.at)!
    expect((request.steps as { order: object }[])[0]).toEqual({
      order: { kind: 'walkTo', x: 3, y: 3 },
    })
    const mount = planOrder(planned('mount', [30, 4]))!
    expect(appendRequest(inCity, mount.order, mount.at)!.steps).toEqual([
      { order: { kind: 'walkTo', x: 30, y: 4 } },
      { order: { kind: 'mount', horseId: 'h1' } },
    ])
  })

  it('crews a ship from the tile of its haven picked (`CONTEXT.md`: Crew)', () => {
    const sea: PlanWorld = {
      ...w,
      vessels: [{ id: 'ship1', x: 10, y: 10, realmId: 'r1' }],
      water: (x) => x >= 10,
    }
    const plan = (...taps: [number, number][]) =>
      taps.reduce<Plan>((p, [x, y]) => pickInto(sea, p, { x, y }), {
        kind: 'boardCrew',
        picked: [],
      })
    expect(planOrder(plan([10, 10], [8, 10]))).toEqual({
      order: { kind: 'board', vesselId: 'ship1', asCrew: true },
      at: { x: 8, y: 10 },
    })
    // Then sailing it to a tile, from aboard: no walk (`CONTEXT.md`: Sailing).
    const sail = [
      [10, 10],
      [14, 3],
    ].reduce<Plan>((p, [x, y]) => pickInto(sea, p, { x: x!, y: y! }), { kind: 'sail', picked: [] })
    expect(planOrder(sail)).toEqual({ order: { kind: 'sail', vesselId: 'ship1', x: 14, y: 3 } })
  })

  it('boards a boat from the shore picked, rows it, gets off and loads it (`CONTEXT.md`: Beside a vessel)', () => {
    // A lake over x 10..14, y 8..12, with the realm's boat v1 at (10, 10) and r2's v2 at (12, 10).
    const lake: PlanWorld = {
      ...w,
      vessels: [
        { id: 'v1', x: 10, y: 10, realmId: 'r1' },
        { id: 'v2', x: 12, y: 10, realmId: 'r2' },
      ],
      water: (x, y) => x >= 10 && x <= 14 && y >= 8 && y <= 12,
    }
    const plan = (kind: Plan['kind'], ...taps: [number, number][]) =>
      taps.reduce<Plan>((p, [x, y]) => pickInto(lake, p, { x, y }), { kind, picked: [] })
    // Only the realm's boat, and a shore tile to board from, are picked.
    expect(plan('boardBoat', [12, 10]).error).toBe('no boat of yours there')
    expect(plan('boardBoat', [10, 10], [11, 10]).error).toBe(
      'that is water: pick the shore beside the boat',
    )
    // Boarding goes after a walk to the shore picked; rowing and getting off need no walk.
    const board = planOrder(plan('boardBoat', [10, 10], [9, 10]))!
    expect(board).toEqual({ order: { kind: 'board', vesselId: 'v1' }, at: { x: 9, y: 10 } })
    const row = planOrder(plan('row', [10, 10], [15, 10]))!
    expect(row).toEqual({ order: { kind: 'row', vesselId: 'v1', x: 15, y: 10 } })
    let request = appendRequest(inCity, board.order, board.at)!
    const queued = { ...inCity, queue: kept(request.steps as QueueStepRequest[]) }
    request = appendRequest(queued, row.order, row.at)!
    expect(request.steps).toEqual([
      { id: 1, order: { kind: 'walkTo', x: 9, y: 10 } },
      { id: 2, order: { kind: 'board', vesselId: 'v1' } },
      { order: { kind: 'row', vesselId: 'v1', x: 15, y: 10 } },
    ])
    // Store and Fetch load and unload it from beside it, walking there themselves.
    expect(planOrder(plan('store', [10, 10]))).toEqual({
      order: { kind: 'store', goods: [...GOODS], to: 'v1' },
    })
    expect(plan('pickUp', [10, 10]).error).toBe('a boat: Store or Fetch to load it')
    // A haul route by boat: the boat, the first stop (walked to first), then the other one, as
    // the Haul task with the boat as its carriage (`CONTEXT.md`: Haul route by water).
    const route = plan('haulBoat', [10, 10], [9, 10], [15, 10])
    expect(planAsk(route)).toBe('haul')
    const setup = { goods: ['wood' as const], returnGoods: [], keepFood: 2 }
    expect(planOrder(route, { ask: 'haul', setup })).toEqual({
      order: { kind: 'task', task: 'haul', carriageId: 'v1', x: 15, y: 10, ...setup },
      at: { x: 9, y: 10 },
    })
  })

  it('feeds someone Down picked on the map, after a walk to their tile (`CONTEXT.md`: Reviving)', () => {
    const seen: PlanWorld = { ...w, toFeed: [{ id: 'ana', x: 12, y: 12 }] }
    const nobody = pickInto(seen, { kind: 'feed', picked: [] }, { x: 13, y: 12 })
    expect(nobody.error).toBe('nobody to feed there')
    const plan = pickInto(seen, { kind: 'feed', picked: [] }, { x: 12, y: 12 })
    expect(planAsk(plan)).toBe('units')
    const feed = planOrder(plan, { ask: 'units', units: 3 })!
    expect(appendRequest(inCity, feed.order, feed.at)!.steps).toEqual([
      { order: { kind: 'walkTo', x: 12, y: 12 } },
      { order: { kind: 'feed', targetId: 'ana', units: 3 } },
    ])
  })

  it('breeds two of the realm’s horses in the stable picked', () => {
    const plan = planned('breed', [30, 4])
    expect(horsesIn(w, w.horses as never, plan.picked[0]!.id).map((h) => h.id)).toEqual([
      'h1',
      'h2',
    ])
    expect(planOrder(plan, { ask: 'horses', horseIds: ['h1', 'h2'] })!.order).toEqual({
      kind: 'task',
      task: 'breed',
      stableId: 'b1',
      horseIds: ['h1', 'h2'],
    })
  })

  it('hitches a horse the card lists from the carriage’s tile, after a walk there', () => {
    const horses = [
      { id: 'h1', x: 3, y: 3, realmId: 'r1' },
      { id: 'h2', x: 3, y: 3, realmId: 'r1' },
      { id: 'h3', x: 4, y: 3, realmId: 'r1' },
      { id: 'h9', x: 3, y: 3, realmId: 'r2' },
    ]
    const plan = planned('hitch', [3, 3])
    expect(planAsk(plan)).toBe('horse')
    expect(planHorses(w, horses as never, plan).map((h) => h.id)).toEqual(['h1', 'h2'])
    expect(planOrder(plan)).toBeUndefined()
    const { order, at } = planOrder(plan, { ask: 'horse', horseId: 'h2' })!
    const request = appendRequest(inCity, order, at)!
    expect(request.steps).toEqual([
      { order: { kind: 'walkTo', x: 3, y: 3 } },
      { order: { kind: 'hitch', carriageId: 'k1', horseId: 'h2' } },
    ])
    expect(queueStepsProblem(request.steps)).toBeUndefined()
  })

  it('teaches and trains at a training ground picked, anyone’s, after a walk there', () => {
    const ground: Building = { id: 'g1', kind: 'trainingGround', cityId: 'c2', x: 24, y: 24 }
    const groundSite: Building = { ...ground, id: 'g2', x: 34, y: 34, site: site.site }
    const tw = { ...w, buildings: [...w.buildings, ground, groundSite] }
    const plan = (kind: Plan['kind'], x: number, y: number) =>
      pickInto(tw, { kind, picked: [] }, { x, y })
    expect(plan('train', 34, 34).error).toBe('no finished training ground there')
    expect(plan('teach', 20, 20).error).toBe('no finished training ground there')

    const train = plan('train', 25, 25)
    expect(planAsk(train)).toBeUndefined()
    const teach = plan('teach', 25, 25)
    expect(planAsk(teach)).toBe('subject')
    expect(planOrder(teach)).toBeUndefined()
    const taught = planOrder(teach, { ask: 'subject', subject: 'combat' })!
    expect(taught.order).toEqual({ kind: 'teach', buildingId: 'g1', subject: 'combat' })

    for (const { order, at } of [planOrder(train)!, taught]) {
      const request = appendRequest(inCity, order, at)!
      expect(request.steps).toEqual([{ order: { kind: 'walkTo', x: 25, y: 25 } }, { order }])
      expect(queueStepsProblem(request.steps)).toBeUndefined()
    }
    expect(planOrder(train)!.order).toEqual({ kind: 'task', task: 'train', groundId: 'g1' })
  })

  it('relocates to a city of the realm picked on the map or from the list', () => {
    // Redbank (c4) is realm r1's second city, with a house and one resident on the way there.
    const hall4: Building = { id: 't4', kind: 'townHall', cityId: 'c4', x: 50, y: 50 }
    const house4: Building = { id: 'hh4', kind: 'house', cityId: 'c4', x: 50, y: 54 }
    const hall2: Building = { id: 't2', kind: 'townHall', cityId: 'c2', x: 40, y: 34 }
    const rw = {
      ...w,
      buildings: [...w.buildings, hall4, house4, hall2],
      cities: [...w.cities, { id: 'c4', realmId: 'r1' }],
    }
    const plan = (x: number, y: number) => pickInto(rw, { kind: 'relocate', picked: [] }, { x, y })
    expect(plan(1, 1).error).toBe('no city of yours there')
    expect(plan(41, 35).error).toBe('no city of yours there')
    const picked = plan(52, 52)
    expect(planAsk(picked)).toBeUndefined()
    const { order, at } = planOrder(picked)!
    expect(order).toEqual({ kind: 'relocate', cityId: 'c4' })
    // It goes there itself: no walk before it.
    expect(at).toBeUndefined()
    const request = appendRequest(inCity, order, at)!
    expect(request.steps).toEqual([{ order }])
    expect(queueStepsProblem(request.steps)).toBeUndefined()

    const seen = {
      buildings: rw.buildings,
      cities: [
        { id: 'c4', name: 'Redbank', realmId: 'r1' },
        { id: 'c1', name: 'Ashford', realmId: 'r1' },
        { id: 'c2', name: 'Theirs', realmId: 'r2' },
      ],
      residents: [
        {
          id: 'w9',
          cityId: 'c1',
          order: {
            kind: 'relocate',
            cityId: 'c4',
            target: { x: 50, y: 50 },
            path: null,
            progress: 0,
          },
        } as const,
      ],
    }
    // Ashford has no town hall in sight, so only Redbank is listed, its room less the one coming.
    const listed = planCities(seen, 'r1')
    const room = freeHousing(seen, { id: 'c4' }) - 1
    expect(listed).toEqual([{ id: 'c4', name: 'Redbank', room, x: 50, y: 50 }])
    expect(room).toBeGreaterThan(0)
    expect(planOrder(pickCity({ kind: 'relocate', picked: [] }, listed[0]!))!.order).toEqual(order)
  })
})

describe('Wait until', () => {
  const wood = {
    kind: 'stock',
    placeId: 's1',
    good: 'wood',
    compare: 'atLeast',
    amount: 20,
  } as const

  it('asks for its condition on the card, picking the place it asks about on the map', () => {
    const fresh: Plan = { kind: 'waitUntil', picked: [] }
    expect(nextPick(fresh)).toBeUndefined()
    expect(planAsk(fresh)).toBe('condition')
    const draft = { ...NEW_DRAFT, amount: 20 }
    const placing = pickPlace(fresh, draft)
    expect(nextPick(placing)?.pick).toBe('place')
    // Another realm's storage, or a house, is nothing to ask about.
    expect(pickInto(w, placing, { x: 40, y: 40 })).toMatchObject({
      error: 'no storage, workplace or site of yours there',
    })
    const picked = pickInto(w, placing, { x: 12, y: 6 })
    expect(nextPick(picked)).toBeUndefined()
    expect(planAsk(picked)).toBe('condition')
    expect(picked.condition).toEqual({ ...draft, placeId: 's1' })
    expect(conditionOf(picked.condition!)).toEqual(wood)
    expect(planOrder(picked, { ask: 'condition', condition: wood })).toEqual({
      order: { kind: 'waitUntil', condition: wood },
    })
    // A workplace of the realm's is one too.
    expect(planPickAt(w, 'place', { x: 20, y: 20 })).toMatchObject({ id: 'f1' })
  })

  it('is checked as the server checks it', () => {
    const step = (condition: unknown) => [{ order: { kind: 'waitUntil', condition } }]
    expect(queueStepsProblem(step(wood))).toBeUndefined()
    expect(queueStepsProblem([{ order: { kind: 'waitUntil' } }])).toBe('step 1: needs a condition')
    expect(queueStepsProblem(step({ kind: 'weather' }))).toBe('step 1: that is no condition')
    expect(queueStepsProblem(step({ ...wood, amount: 1.5 }))).toBe(
      "step 1: a condition's amount is a whole number from 0",
    )
    expect(queueStepsProblem(step({ kind: 'hour', side: 'after', hour: 24 }))).toBe(
      "step 1: a condition's hour is a whole number from 0 to 23",
    )
    expect(queueStepsProblem(step({ kind: 'need', need: 'health', side: 'above', share: 2 }))).toBe(
      "step 1: a condition's share is from 0 to 1",
    )
    expect(queueStepsProblem([{ order: { kind: 'waitUntil', condition: wood, x: 1 } }])).toBe(
      'step 1: a Wait until holds only its condition',
    )
  })

  it('names its condition in the step', () => {
    const names = { buildings: [storage], cities: [{ id: 'c1', name: 'Ashford' }] }
    expect(stepLabel({ kind: 'waitUntil', condition: wood }, names)).toBe(
      'Wait until the storage in Ashford holds at least 20 wood',
    )
    const label = (condition: Condition) => conditionLabel(condition)
    expect(
      label({ kind: 'carries', vehicle: true, good: 'stone', compare: 'lessThan', amount: 5 }),
    ).toBe('their carriage or boat carries less than 5 stone')
    expect(label({ kind: 'load', load: 'full' })).toBe('they are full')
    expect(label({ kind: 'need', need: 'hunger', side: 'below', share: 0.3 })).toBe(
      'their hunger meter is below 30%',
    )
    expect(label({ kind: 'mounted', is: false })).toBe('they are not mounted')
    expect(label({ kind: 'hour', side: 'after', hour: 6 })).toBe('it is 06:00 or later')
  })
})
