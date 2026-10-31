import { describe, expect, it } from 'vitest'
import type { QueueStepRequest } from '@csp/shared'
import { queueRows } from './queue-view.js'
import {
  SAVED_QUEUES_VERSION,
  gonePlace,
  list,
  load,
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
    ;(loaded[2]!.order.goods as string[]).push('wood')
    expect(load(queues, 'Mine run')[2]!.order.goods).toEqual(['stone'])
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
    const steps = load(queues, 'Mine run').map((s, i) => ({ ...s, id: i + 1 }))
    const q = { steps, current: -1 }
    // The mine (b1) is torn down: neither in sight nor last seen.
    const rows = queueRows(q, { buildings: [], lastSeen: [{ id: 'b2', kind: 'storage' } as never] })
    expect(rows.map((r) => r.gone)).toEqual([undefined, 'the workplace is gone', undefined])
    // Without the last-seen map to check against, nothing is flagged.
    expect(queueRows(q, { buildings: [] }).every((r) => r.gone === undefined)).toBe(true)
  })
})
