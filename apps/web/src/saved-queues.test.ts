import { describe, expect, it } from 'vitest'
import type { QueueStepRequest } from '@csp/shared'
import { stepRow } from './queue-view.js'
import { planRows, stepCount, unroll, withIds, type PlanItem } from './plan-blocks.js'
import {
  SAVED_QUEUES_VERSION,
  gonePlace,
  list,
  load,
  migrate,
  parseQueues,
  queuesKey,
  readQueues,
  remove,
  save,
  storeQueues,
} from './saved-queues.js'

const mineRun: QueueStepRequest[] = [
  { id: 4, order: { kind: 'walkTo', x: 3, y: 4 } },
  { id: 5, order: { kind: 'task', task: 'work', workplaceId: 'b1' }, minutes: 60 },
  { id: 6, order: { kind: 'store', goods: ['stone'], to: 'b2' } },
]

/** A browser's storage, in memory. */
function memory(): Storage {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as Storage
}

describe('saved queues', () => {
  it('saves the steps under a name and loads fresh copies without ids', () => {
    const queues = save({}, ' Mine run ', mineRun, 1000)
    expect(Object.keys(queues)).toEqual(['Mine run'])
    const loaded = load(queues, 'Mine run')
    expect(loaded).toEqual([
      { order: { kind: 'walkTo', x: 3, y: 4 } },
      { order: { kind: 'task', task: 'work', workplaceId: 'b1' }, minutes: 60 },
      { order: { kind: 'store', goods: ['stone'], to: 'b2' } },
    ])
    // Changing what was loaded leaves the saved queue as it was.
    ;((loaded[2] as QueueStepRequest).order.goods as string[]).push('wood')
    expect((load(queues, 'Mine run')[2] as QueueStepRequest).order.goods).toEqual(['stone'])
    expect(load(queues, 'Nothing here')).toEqual([])
  })

  it('saves nothing with no name or no steps', () => {
    expect(save({}, '  ', mineRun, 1)).toEqual({})
    expect(save({}, 'Empty', [], 1)).toEqual({})
  })

  it('overwrites a queue saved under the same name', () => {
    const first = save({}, 'Mine run', mineRun, 1000)
    const second = save(first, 'Mine run', mineRun.slice(0, 1), 2000)
    expect(list(second)).toEqual([
      { name: 'Mine run', steps: [{ order: mineRun[0]!.order }], savedAt: 2000 },
    ])
  })

  it('deletes a saved queue, and lists the latest saved first', () => {
    let queues = save({}, 'Old', mineRun, 1000)
    queues = save(queues, 'New', mineRun, 3000)
    queues = save(queues, 'Middle', mineRun, 2000)
    expect(list(queues).map((q) => q.name)).toEqual(['New', 'Middle', 'Old'])
    queues = remove(queues, 'Middle')
    expect(list(queues).map((q) => q.name)).toEqual(['New', 'Old'])
  })

  it('keeps them in the browser per realm, surviving a reload', () => {
    const storage = memory()
    storeQueues(storage, 'r1', save({}, 'Mine run', mineRun, 1000))
    expect(storage.getItem(queuesKey('r1'))).toContain(`"version":${SAVED_QUEUES_VERSION}`)
    expect(load(readQueues(storage, 'r1'), 'Mine run')).toHaveLength(3)
    expect(readQueues(storage, 'r2')).toEqual({})
    // Without storage they just aren't remembered.
    expect(readQueues(undefined, 'r1')).toEqual({})
    expect(() => storeQueues(undefined, 'r1', {})).not.toThrow()
  })

  it('ignores corrupt storage and corrupt entries', () => {
    expect(parseQueues(null)).toEqual({})
    expect(parseQueues('not json')).toEqual({})
    expect(parseQueues('[1, 2]')).toEqual({})
    // Another shape than this planner's is not read as one.
    expect(parseQueues(JSON.stringify({ version: 99, queues: {} }))).toEqual({})
    const good = { name: 'Good', steps: [{ order: { kind: 'walkTo', x: 1, y: 1 } }], savedAt: 5 }
    const text = JSON.stringify({
      version: SAVED_QUEUES_VERSION,
      queues: {
        Good: good,
        NoSteps: { name: 'NoSteps', steps: [], savedAt: 5 },
        NotAnOrder: { name: 'NotAnOrder', steps: [{ order: 'walk' }], savedAt: 5 },
        HalfMinutes: {
          name: 'HalfMinutes',
          steps: [{ order: { kind: 'walkTo' }, minutes: 1.5 }],
          savedAt: 5,
        },
        NoDate: { name: 'NoDate', steps: good.steps },
        Renamed: { ...good, name: 'Other' },
        Null: null,
      },
    })
    expect(parseQueues(text)).toEqual({ Good: good })
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readQueues(throwing, 'r1')).toEqual({})
  })
})

describe('steps whose place is gone', () => {
  const known = {
    buildings: [{ id: 'b1' }],
    lastSeen: [{ id: 'b2' }],
  }

  it('flags a step whose building is neither in sight nor last seen', () => {
    const work = (id: string) => ({ kind: 'task', task: 'work', workplaceId: id })
    expect(gonePlace(work('b1'), known)).toBeUndefined()
    expect(gonePlace(work('b2'), known)).toBeUndefined()
    expect(gonePlace(work('b9'), known)).toBe('the workplace is gone')
    expect(gonePlace({ kind: 'task', task: 'feedStable', stableId: 'b9' }, known)).toBe(
      'the stable is gone',
    )
    expect(gonePlace({ kind: 'task', task: 'tearDown', buildingId: 'b9' }, known)).toBe(
      'the building is gone',
    )
    const drop = (spot: object) => ({ kind: 'drop', spot, goods: {} })
    expect(gonePlace(drop({ kind: 'storage', storageId: 'b9' }), known)).toBe('the storage is gone')
    expect(gonePlace(drop({ kind: 'site', siteId: 'b9' }), known)).toBe('the site is gone')
  })

  it("doesn't take tiles, carriages or horses out of sight for gone", () => {
    expect(gonePlace({ kind: 'walkTo', x: 1, y: 1 }, known)).toBeUndefined()
    expect(gonePlace({ kind: 'board', carriageId: 'carriage1' }, known)).toBeUndefined()
    expect(gonePlace({ kind: 'mount', horseId: 'horse1' }, known)).toBeUndefined()
    expect(gonePlace({ kind: 'store', goods: [], to: 'carriage1' }, known)).toBeUndefined()
    const drop = { kind: 'drop', spot: { kind: 'carriage', carriageId: 'k' }, goods: {} }
    expect(gonePlace(drop, known)).toBeUndefined()
  })

  it('flags a loaded step in the planner when its workplace was torn down', () => {
    const queues = save({}, 'Mine run', mineRun, 1000)
    const steps = unroll(withIds(load(queues, 'Mine run'), 1).items)
    const rowsOf = (lastSeen?: never[]) =>
      steps.map((s) => stepRow({ ...s, id: s.id! }, false, { buildings: [], lastSeen }))
    // The mine (b1) is torn down: neither in sight nor last seen.
    const rows = rowsOf([{ id: 'b2', kind: 'storage' } as never])
    expect(rows.map((r) => r.gone)).toEqual([undefined, 'the workplace is gone', undefined])
    // Without the last-seen map to check against, nothing is flagged.
    expect(rowsOf().every((r) => r.gone === undefined)).toBe(true)
  })
})

describe('saved repeat blocks', () => {
  // The epic's "Mine run" with its walk home and store wrapped in Repeat x5.
  const repeated: PlanItem[] = [
    mineRun[0]!,
    mineRun[1]!,
    { id: 7, repeat: 5, items: [{ id: 8, order: { kind: 'walkTo', x: 9, y: 3 } }, mineRun[2]!] },
  ]

  it('keeps a block as one, with its count, through storage', () => {
    const storage = memory()
    storeQueues(storage, 'r1', save({}, 'Mine run', repeated, 1000))
    const loaded = load(readQueues(storage, 'r1'), 'Mine run')
    expect(stepCount(loaded)).toBe(2 + 10)
    expect(planRows(withIds(loaded, 1).items).map((r) => [r.kind, r.depth])).toEqual([
      ['step', 0],
      ['step', 0],
      ['block', 0],
      ['step', 1],
      ['step', 1],
    ])
    expect(loaded[2]).toMatchObject({ repeat: 5 })
    expect(JSON.stringify(loaded)).not.toContain('"id"')
  })

  it('reads the plain lists an older planner saved (version 1) as they were', () => {
    const plain = {
      name: 'Old run',
      steps: [{ order: { kind: 'walkTo', x: 1, y: 1 } }],
      savedAt: 5,
    }
    const text = JSON.stringify({ version: 1, queues: { 'Old run': plain } })
    expect(parseQueues(text)).toEqual({ 'Old run': plain })
    expect(migrate(1, { 'Old run': plain })).toEqual({ 'Old run': plain })
    expect(migrate(SAVED_QUEUES_VERSION + 1, {})).toBeUndefined()
    expect(SAVED_QUEUES_VERSION).toBe(2)
  })

  it('drops an entry with a block that repeats nothing or no whole number of times', () => {
    const entry = (steps: unknown) => ({ name: 'Bad', steps, savedAt: 5 })
    const walk = { order: { kind: 'walkTo', x: 1, y: 1 } }
    for (const steps of [
      [{ repeat: 2, items: [] }],
      [{ repeat: 0, items: [walk] }],
      [{ repeat: 1.5, items: [walk] }],
      [{ repeat: 2, items: [{ order: 'walk' }] }],
    ]) {
      const text = JSON.stringify({ version: SAVED_QUEUES_VERSION, queues: { Bad: entry(steps) } })
      expect(parseQueues(text)).toEqual({})
    }
  })
})
