import type { Building, ResidentOrder, ScriptSummary } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { doingLine, type DoingOf } from './doing-view.js'

const summary = (id: number, task: ScriptSummary['task']): ScriptSummary => ({
  id,
  name: task ? `${task} (default)` : 'Mine',
  activeVersion: 1,
  latestVersion: 1,
  task,
  followsDefault: true,
  params: [],
})
const scripts = [
  summary(1, 'work'),
  summary(2, 'build'),
  summary(3, 'haul'),
  summary(4, 'tearDown'),
  summary(6, 'feedStable'),
  summary(5, null),
]
const buildings: Pick<Building, 'id' | 'kind'>[] = [
  { id: 's1', kind: 'storage' },
  { id: 'st1', kind: 'stable' },
]
const at = { x: 4, y: 5 }

const walk: ResidentOrder = { kind: 'walkTo', target: at, path: [[4, 5]], progress: 0 }
const store: ResidentOrder = {
  kind: 'store',
  goods: { iron: null },
  to: { kind: 'storage', storageId: 's1' },
  phase: 'walking',
  path: null,
  progress: 0,
}
const fetch: ResidentOrder = {
  kind: 'fetch',
  goods: { wood: 10, stone: 4 },
  from: { kind: 'storage', storageId: 's1' },
  phase: 'walking',
  path: null,
  progress: 0,
}
const work: ResidentOrder = { kind: 'workAt', buildingId: 'b1', at, progress: 0 }
const build: ResidentOrder = { kind: 'build', building: 'house', at, siteId: 'x1' }
const tearDown: ResidentOrder = { kind: 'tearDown', buildingId: 'b1', at }
const haul: ResidentOrder = {
  kind: 'haul',
  carriageId: 'k1',
  from: { x: 1, y: 1 },
  to: at,
  goods: ['wood'],
  returnGoods: [],
  keepFood: 2,
  moving: null,
  stop: 'to',
  phase: 'driving',
  path: null,
  progress: 0,
}

const line = (r: DoingOf) => doingLine(r, { scripts, buildings })

describe('doingLine', () => {
  it('names the task and what its current order has them doing', () => {
    const worker = { scriptId: 1, building: 'mine' as const }
    expect(line({ order: work, script: worker })).toBe('Working the mine')
    expect(
      line({ order: { ...work, makes: 'sword' }, script: { ...worker, building: 'smithy' } }),
    ).toBe('Working the smithy: making sword')
    expect(line({ order: store, script: worker })).toBe(
      'Working the mine: carrying iron to the storage',
    )
    expect(line({ order: walk, script: worker })).toBe(
      'Working the mine: walking to 4, 5 · 1 tiles to go',
    )
    const builder = { scriptId: 2, building: 'house' as const }
    expect(line({ order: build, script: builder })).toBe('Building a house')
    expect(line({ order: fetch, script: builder })).toBe(
      'Building a house: fetching 10 wood and 4 stone from the storage',
    )
    expect(line({ order: null, script: builder })).toBe('Building a house: waiting')
    expect(line({ order: build, script: { scriptId: 2, building: 'lumberCamp' } })).toBe(
      'Building a lumber camp',
    )
    expect(line({ order: tearDown, script: { scriptId: 4, building: 'farm' } })).toBe(
      'Tearing down the farm',
    )
    expect(line({ order: haul, script: { scriptId: 3 } })).toBe('Hauling wood to 4, 5')
    expect(line({ order: null, script: { scriptId: 3 } })).toBe('Hauling: waiting')
    // Feed the stable has no order of its own: it waits, walks, fetches and stores.
    const feeder = { scriptId: 6 }
    expect(line({ order: null, script: feeder })).toBe('Feeding the stable: waiting')
    expect(line({ order: { ...fetch, goods: { food: 12 } }, script: feeder })).toBe(
      'Feeding the stable: fetching 12 food from the storage',
    )
    expect(
      line({
        order: { ...store, goods: { food: 12 }, to: { kind: 'storage', storageId: 'st1' } },
        script: feeder,
      }),
    ).toBe('Feeding the stable: carrying 12 food to the stable')
  })

  it('takes the task from the server when the script is none of the Player’s', () => {
    expect(line({ order: work, script: { scriptId: 0, task: 'work', building: 'farm' } })).toBe(
      'Working the farm',
    )
  })

  it('says where goods go or come from, the stable or a carriage too', () => {
    const toStable = {
      ...store,
      goods: { food: 6 },
      to: { kind: 'storage' as const, storageId: 'st1' },
    }
    expect(line({ order: toStable })).toBe('Carrying 6 food to the stable')
    const fromCarriage = {
      ...fetch,
      goods: { food: null },
      from: { kind: 'carriage' as const, carriageId: 'k1' },
    }
    expect(line({ order: fromCarriage })).toBe('Fetching food from the carriage')
    expect(line({ order: { ...store, phase: 'refilling' } })).toBe('Taking food along')
  })

  it('shows a script’s own order lines without a task, and Idle without an order', () => {
    expect(line({ order: walk, script: { scriptId: 5 } })).toBe('Walking to 4, 5 · 1 tiles to go')
    expect(line({ order: null, script: { scriptId: 5 } })).toBe('Idle')
    expect(line({ order: null })).toBe('Idle')
    expect(line({ order: null, carrying: { since: 0 } })).toBe('Carrying a child')
  })

  it('says Riding where a rider would walk (CONTEXT.md: Riding)', () => {
    const riding = 'h1'
    expect(line({ order: walk, riding })).toBe('Riding to 4, 5 · 1 tiles to go')
    expect(line({ order: walk, riding, script: { scriptId: 5 } })).toBe(
      'Riding to 4, 5 · 1 tiles to go',
    )
    expect(line({ order: walk, riding, script: { scriptId: 1, building: 'mine' } })).toBe(
      'Working the mine: riding to 4, 5 · 1 tiles to go',
    )
    const road: ResidentOrder = {
      kind: 'roadLine',
      tiles: [[4, 5]],
      phase: 'walking',
      path: null,
      progress: 0,
      siteId: null,
    }
    expect(line({ order: road, riding })).toBe('Riding to lay road at 4, 5 · 1 road tile to go')
    // Their own doing() still wins.
    expect(line({ order: walk, riding, script: { scriptId: 5, doing: 'Scouting' } })).toBe(
      'Scouting',
    )
  })

  it('shows what the script last gave doing() instead', () => {
    expect(
      line({
        order: work,
        script: { scriptId: 1, building: 'farm', doing: 'Feeding the stable: waiting' },
      }),
    ).toBe('Feeding the stable: waiting')
    expect(line({ order: null, script: { scriptId: 5, doing: 'Guarding' } })).toBe('Guarding')
  })
})
