import {
  TERRAIN_SPEED,
  TICKS_PER_GAME_YEAR,
  Terrain,
  UNEXPLORED,
  WALK_TICKS_PER_TILE,
  type Building,
  type ResidentOrder,
  type ScriptSummary,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { arrivalOf, doingLine, interruptedLine, type DoingOf } from './doing-view.js'

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
  summary(7, 'breed'),
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
  it('says what a teacher teaches (`CONTEXT.md`: Teacher)', () => {
    const teach = (subject: 'strength' | 'combat'): ResidentOrder => ({
      kind: 'teach',
      buildingId: 'g1',
      subject,
    })
    expect(line({ order: teach('strength') })).toBe('Teaching Strength')
    expect(line({ order: teach('combat') })).toBe('Teaching Combat')
  })

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
    // Breed horses: its own order reads as the task; while getting Food it fetches.
    const breeder = { scriptId: 7, building: 'stable' as const }
    const breed: ResidentOrder = {
      kind: 'breed',
      stableId: 'st1',
      horseIds: ['h1', 'h2'],
      at,
      progress: 0,
    }
    expect(line({ order: breed, script: breeder })).toBe('Breeding horses')
    expect(line({ order: { ...fetch, goods: { food: 10 } }, script: breeder })).toBe(
      'Breeding horses: fetching 10 food from the storage',
    )
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

  it('says a passenger is aboard, and where the carriage is heading while it is driven', () => {
    const aboard = (residents: { order: ResidentOrder | null }[], more: Partial<DoingOf> = {}) =>
      doingLine({ order: null, aboard: 'k1', ...more }, { scripts, buildings, residents })
    expect(aboard([])).toBe('Aboard a carriage')
    const drive: ResidentOrder = {
      kind: 'drive',
      carriageId: 'k1',
      target: { x: 12, y: 30 },
      path: null,
      progress: 0,
    }
    expect(aboard([{ order: null }, { order: drive }])).toBe(
      'Aboard a carriage · heading to 12, 30',
    )
    // Another carriage's driver says nothing about this one.
    expect(aboard([{ order: { ...drive, carriageId: 'k2' } }])).toBe('Aboard a carriage')
    // On a haul route: heading to the stop it drives to, and only aboard while it loads.
    expect(aboard([{ order: haul }])).toBe('Aboard a carriage · heading to 4, 5')
    expect(aboard([{ order: { ...haul, phase: 'loading' } }])).toBe('Aboard a carriage')
    // Instead of Idle, waiting or expecting a child; a script's own doing() still wins.
    expect(aboard([], { script: { scriptId: 5 } })).toBe('Aboard a carriage')
    expect(aboard([], { script: { scriptId: 1, building: 'farm' } })).toBe('Aboard a carriage')
    expect(aboard([], { carrying: { since: 0 } })).toBe('Aboard a carriage')
    expect(aboard([], { script: { scriptId: 5, doing: 'Riding along' } })).toBe('Riding along')
  })

  it('says about when a walker, rider or driver arrives (CONTEXT.md: Doing, Estimates)', () => {
    const soon = (r: DoingOf, arrives: number) => doingLine(r, { scripts, buildings, arrives })
    expect(soon({ order: walk }, 180)).toBe('Walking to 4, 5 · about 3 min (3 game hours)')
    expect(soon({ order: walk, riding: 'h1' }, 30)).toBe('Riding to 4, 5 · under a minute')
    const drive: ResidentOrder = {
      kind: 'drive',
      carriageId: 'k1',
      target: at,
      path: [],
      progress: 0,
    }
    expect(soon({ order: drive }, 1200)).toBe('Driving to 4, 5 · about 20 min (a game day)')
    const hauling = { ...haul, path: [[4, 5]] as [number, number][] }
    expect(soon({ order: hauling, script: { scriptId: 3 } }, 180)).toBe(
      'Hauling wood to 4, 5 · about 3 min (3 game hours)',
    )
    expect(soon({ order: walk, script: { scriptId: 1, building: 'mine' } }, 180)).toBe(
      'Working the mine: walking to 4, 5 · about 3 min (3 game hours)',
    )
  })
})

describe('arrivalOf', () => {
  it('counts a road over any terrain, and unexplored ground as Plains', () => {
    const stat = { base: 10, trained: 0 }
    const r = {
      id: 'r1',
      name: 'Ada',
      owner: 'me',
      cityId: null,
      x: 0,
      y: 0,
      stats: { strength: stat, endurance: stat, agility: stat, intellect: stat },
      skills: {},
      health: 100,
      hunger: 100,
      bornAt: -30 * TICKS_PER_GAME_YEAR,
      lifespan: 60,
      carried: {},
      order: {
        kind: 'walkTo' as const,
        target: { x: 2, y: 0 },
        path: [
          [1, 0],
          [2, 0],
        ] as [number, number][],
        progress: 0,
      },
    }
    const road = { id: 'rd', kind: 'road' as const, x: 2, y: 0 } as Building
    const world = { size: 64, tick: 0, horses: [], carriages: [], buildings: [road] }
    const ticks = arrivalOf(world, (x) => (x === 1 ? UNEXPLORED : Terrain.Mountain))(r)
    expect(ticks).toBeCloseTo(
      WALK_TICKS_PER_TILE / TERRAIN_SPEED[Terrain.Plains] +
        WALK_TICKS_PER_TILE / TERRAIN_SPEED[Terrain.Road],
    )
  })
})

describe('defending (`CONTEXT.md`: Defence script)', () => {
  const work: ResidentOrder = { kind: 'workAt', buildingId: 'f1', at, progress: 0 }
  it('says what Defend says, and what goes on once it ends', () => {
    const defending: DoingOf = {
      order: walk,
      script: { scriptId: 7, task: 'defend', doing: 'Defending: fleeing home' },
    }
    expect(doingLine(defending, { scripts, buildings })).toBe('Defending: fleeing home')
    expect(doingLine({ order: null, script: { scriptId: 0, task: 'defend' } }, {})).toBe(
      'Defending: waiting',
    )
    const kept = { order: work, script: { scriptId: 1, building: 'farm' as const } }
    expect(interruptedLine({ interrupted: kept }, { scripts, buildings })).toBe(
      'Then: working the farm',
    )
    expect(interruptedLine({ interrupted: { order: walk } }, {})).toBe(
      'Then: walking to 4, 5 · 1 tiles to go',
    )
    expect(interruptedLine({}, {})).toBeUndefined()
  })
})
