import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Building, Resident, Stock } from '@csp/shared-types'
import {
  SMITHY_WORK,
  buildingOrder,
  buildingOrderRows,
  realmRequests,
  walkFirst,
  type OrderedBuilding,
} from './building-orders.js'
import { whoRows, whoTitle, whyNot, type WhoResident } from './who-list-view.js'

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
    cityId: null,
    ...more,
  }) as Resident
const child = { bornAt: TICK } as Partial<Resident>
const working = {
  order: { kind: 'walkTo', target: { x: 0, y: 0 }, progress: 0 },
} as unknown as Partial<Resident>

const farm: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 10, y: 10 }
const stable: Building = { id: 's1', kind: 'stable', cityId: 'c1', x: 20, y: 20 }
const ground: Building = { id: 'g1', kind: 'trainingGround', cityId: 'c1', x: 30, y: 30 }
const house: Building = { id: 'h1', kind: 'house', cityId: 'c1', x: 40, y: 40 }
const site = (b: Building) =>
  ({ ...b, site: { needs: {}, delivered: {}, work: 0 } }) as unknown as Building

const ctx = {
  tick: TICK,
  size: SIZE,
  free: () => true,
  seen: { buildings: [farm, stable, ground, house] },
}
const ids = (rows: { id: string; reason?: string }[]) =>
  rows.map((r) => (r.reason ? `${r.id} (${r.reason})` : r.id))

describe('the orders a building’s card starts', () => {
  const ours = { ours: true, horses: 0 }

  it('offers Work and Tear down at a workplace, of any realm, as it has no owner', () => {
    expect(ids(buildingOrderRows(farm, ours))).toEqual(['work', 'tearDown'])
    expect(ids(buildingOrderRows(farm, { ours: false, horses: 0 }))).toEqual(['work', 'tearDown'])
  })

  it('offers Tear down at a building of the realm only, and Work at no house', () => {
    expect(ids(buildingOrderRows(house, ours))).toEqual(['tearDown'])
    expect(ids(buildingOrderRows(house, { ours: false, horses: 0 }))).toEqual([])
  })

  it('offers Build this site at a site of the realm, and Work there for a workplace kind', () => {
    expect(ids(buildingOrderRows(site(house), ours))).toEqual(['buildSite', 'tearDown'])
    expect(ids(buildingOrderRows(site(farm), ours))).toEqual(['work', 'buildSite', 'tearDown'])
    expect(ids(buildingOrderRows(site(house), { ours: false, horses: 0 }))).toEqual([])
  })

  it('greys Work at a smithy, where each picks what to make', () => {
    const smithy = { ...farm, kind: 'smithy' } as OrderedBuilding
    expect(buildingOrderRows(smithy, ours)[0]).toMatchObject({ id: 'work', reason: SMITHY_WORK })
  })

  it('offers Feed the stable and Breed horses at a stable, Breed greyed without two horses', () => {
    expect(ids(buildingOrderRows(stable, { ours: true, horses: 2 }))).toEqual([
      'feedStable',
      'breed',
      'tearDown',
    ])
    expect(ids(buildingOrderRows(stable, { ours: true, horses: 1 }))).toContain(
      'breed (fewer than two of your horses in it)',
    )
  })

  it('offers Teach and Train at a training ground, greyed until it is finished', () => {
    expect(ids(buildingOrderRows(ground, ours))).toEqual(['teach', 'train', 'tearDown'])
    expect(ids(buildingOrderRows(site(ground), ours))).toEqual([
      'buildSite',
      'teach (not finished yet)',
      'train (not finished yet)',
      'tearDown',
    ])
  })

  it('gives the group card’s orders, Breed and Teach once their pair or subject is picked', () => {
    expect(buildingOrder('work', farm, 'farm')).toEqual({
      kind: 'work',
      workplace: { id: 'f1', kind: 'farm', x: 10, y: 10 },
      name: 'farm',
    })
    expect(buildingOrder('buildSite', site(house), 'house')).toEqual({
      kind: 'build',
      building: 'house',
      at: { x: 40, y: 40 },
    })
    expect(buildingOrder('breed', stable, 'stable')).toBeUndefined()
    expect(buildingOrder('breed', stable, 'stable', { horseIds: ['a', 'b'] })).toMatchObject({
      kind: 'breed',
      horseIds: ['a', 'b'],
    })
    expect(buildingOrder('teach', ground, 'x', { subject: 'strength' })).toEqual({
      kind: 'teach',
      subject: 'strength',
    })
  })

  it('names the who-list after the order', () => {
    expect(whoTitle(buildingOrder('work', farm, 'farm')!)).toBe('Work at the farm')
    expect(whoTitle(buildingOrder('tearDown', house, 'house')!)).toBe('Tear down the house')
    expect(whoTitle(buildingOrder('buildSite', site(house), 'house')!)).toBe('Build a house')
  })
})

describe('the who-list of an order about a building', () => {
  const at = { x: stable.x, y: stable.y }
  const w = { tick: TICK, size: SIZE, seen: ctx.seen, at }

  it('lists those far from the stable as able to feed it: they walk there first', () => {
    expect(whyNot({ kind: 'feedStable' }, resident('a', 0, 0) as WhoResident, undefined, w)).toBe(
      undefined,
    )
  })

  it('still turns down children, by the reasons the group card has', () => {
    expect(whyNot({ kind: 'train' }, resident('a', 0, 0, child) as WhoResident, undefined, w)).toBe(
      'a child',
    )
    const rows = whoRows(
      { kind: 'feedStable' },
      [resident('a', 0, 0, child), resident('b', 1, 1)] as WhoResident[],
      at,
      () => undefined,
      w,
    )
    expect(rows.map((r) => [r.id, r.why])).toEqual([
      ['b', undefined],
      ['a', 'a child'],
    ])
  })
})

describe('far residents walk first', () => {
  const work = buildingOrder('work', farm, 'farm')!
  const task = { kind: 'task', task: 'work', workplaceId: 'f1' }

  it('gives one already there the plain order', () => {
    const { requests } = realmRequests(work, [resident('a', 10, 10)], { ...ctx, target: farm })
    expect(requests).toEqual([{ residentId: 'a', order: { ...task, residentId: 'a' } }])
  })

  it('gives one elsewhere a queue: walk there, then the order, replacing what they do', () => {
    const far = resident('a', 0, 0, working)
    const { requests, skipped } = realmRequests(work, [far], { ...ctx, target: farm })
    expect(skipped).toEqual([])
    expect(requests).toEqual([
      {
        residentId: 'a',
        order: {
          kind: 'queue',
          residentId: 'a',
          steps: [{ order: { kind: 'walkTo', x: 10, y: 10 } }, { order: task }],
        },
      },
    ])
  })

  it('appends both steps to the queue of one given it After', () => {
    const queued = resident('a', 0, 0, {
      queue: {
        items: [{ id: 1, order: { kind: 'walkTo', x: 5, y: 5 } }],
        loop: false,
        nextStepId: 2,
      },
    } as unknown as Partial<Resident>)
    const { requests } = realmRequests(work, [queued], {
      ...ctx,
      target: farm,
      after: new Set(['a']),
    })
    expect(requests[0]!.order).toMatchObject({
      kind: 'editQueue',
      steps: [
        { id: 1, order: { kind: 'walkTo', x: 5, y: 5 } },
        { order: { kind: 'walkTo', x: 10, y: 10 } },
        { order: task },
      ],
    })
  })

  it('finds the stable or ground for an order that names none from where they will stand', () => {
    const { requests } = realmRequests({ kind: 'feedStable' }, [resident('a', 0, 0)], {
      ...ctx,
      target: stable,
    })
    expect(requests[0]!.order).toMatchObject({
      kind: 'queue',
      steps: [
        { order: { kind: 'walkTo', x: 20, y: 20 } },
        { order: { kind: 'task', task: 'feedStable', stableId: 's1' } },
      ],
    })
  })

  it('still sends one teacher per ground, the first of those ticked', () => {
    const { requests, skipped } = realmRequests(
      { kind: 'teach', subject: 'strength' },
      [resident('a', 0, 0), resident('b', 30, 30)],
      { ...ctx, target: ground },
    )
    expect(requests.map((q) => q.residentId)).toEqual(['a'])
    expect(skipped).toEqual([{ id: 'b', name: 'B', why: 'A teaches there' }])
  })

  it('still skips those who can’t take it, saying why', () => {
    const { requests, skipped } = realmRequests(work, [resident('a', 0, 0, child)], {
      ...ctx,
      target: farm,
    })
    expect(requests).toEqual([])
    expect(skipped).toEqual([{ id: 'a', name: 'A', why: 'a child' }])
  })

  it('sends Build as the group card does: the task walks there itself', () => {
    const build = buildingOrder('buildSite', site(house), 'house')!
    const { requests } = realmRequests(build, [resident('a', 0, 0)], { ...ctx, target: house })
    expect(requests[0]!.order).toMatchObject({ kind: 'task', task: 'build', at: { x: 40, y: 40 } })
  })

  it('walkFirst: Now there is the plain request, Now elsewhere a new queue', () => {
    const r = resident('a', 0, 0, working)
    const request = { kind: 'task', task: 'tearDown', buildingId: 'h1', residentId: 'a' } as const
    expect(walkFirst(r, request, { x: 0, y: 0 }, false, true)).toBe(request)
    expect(walkFirst(r, request, { x: 40, y: 40 }, false, false)).toEqual({
      kind: 'queue',
      residentId: 'a',
      steps: [
        { order: { kind: 'walkTo', x: 40, y: 40 } },
        { order: { kind: 'task', task: 'tearDown', buildingId: 'h1' } },
      ],
    })
  })
})
