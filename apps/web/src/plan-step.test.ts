import {
  GOODS,
  QUEUE_STEP_KINDS,
  queueStepsProblem,
  type Building,
  type Queue,
  type QueueStepRequest,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  PLAN_STEPS,
  horsesIn,
  nextPick,
  pickInto,
  planAsk,
  planOrder,
  planPickAt,
  type Plan,
  type PlanAnswer,
  type PlanAsk,
  type PlanWorld,
} from './plan-step.js'
import { appendRequest, type Queued } from './queue-view.js'

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
    steps: steps.map((s, i) => ({
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
      haul: { ask: 'haul', setup: { goods: ['wood'], returnGoods: [], keepFood: 0 } },
      script: { ask: 'script', scriptId: 1 },
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
    // Working, building, tearing down and hauling are planned as tasks, as the card gives them.
    const asTasks = ['build', 'tearDown', 'workAt', 'haul']
    expect([...kinds].sort()).toEqual(QUEUE_STEP_KINDS.filter((k) => !asTasks.includes(k)).sort())
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
    expect(r.queue!.steps.map((s) => s.order)).toEqual([
      { kind: 'walkTo', x: 20, y: 20 },
      { kind: 'task', task: 'work', workplaceId: 'f1' },
      { kind: 'store', goods: [...GOODS], to: 's1' },
    ])
    // The work gets a duration once a step follows it.
    expect(r.queue!.steps[1]!.minutes).toBeGreaterThan(0)
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
})
