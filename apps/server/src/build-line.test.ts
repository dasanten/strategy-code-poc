import {
  BUILD_MATERIALS,
  MAX_HUNGER,
  OWN_FOOD,
  TASKS,
  Terrain,
  ticksForAge,
  lineToBuild,
  type BuildLine,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { lineBuildersApart, lineBuildersOnTheirLine } from './script-runner.js'
import { seenScript } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Build line (`CONTEXT.md`: Build line; ADR 0018): a task with its own default script, given with
 * the line's two picked ends. The builder walks to the line, builds each tile still to build with
 * what they carry first and stone fetched from storage when it runs out; with none in any storage
 * they lay out every tile's site and end, saying why. Started without a line it ends.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's version of the Build line default (`defaultScripts`). */
const BUILD_LINE = 7 * 100 + TASKS.indexOf('buildLine') + 1
const STONE = BUILD_MATERIALS.road!.stone!
/** A 5-tile road line, east from (10, 12) to (14, 12). */
const LINE: BuildLine = { building: 'road', from: { x: 10, y: 12 }, to: { x: 14, y: 12 } }

/**
 * Realm r1 (Player 7) with city c1, resident w1 standing at (4, 20) away from the line, carrying
 * their own food and stone for two tiles, and storage s1 at (12, 26) holding `stock`.
 */
function setup(stock: Building['stock'] = { stone: 50 }) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 26, stock })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 4, y: 20, tick: 0 })
  w1.cityId = 'c1'
  w1.stats.strength = { base: 10, trained: 0 }
  w1.carried = { food: OWN_FOOD, stone: 2 * STONE }
  world.residents.push(w1)
  const scripts = defaultScripts(terrain, [me])
  const orders = new OrderQueue(scripts.kinds, terrain)
  const walking = new Walking(terrain)
  /** One tick as the game runs it: orders, scripts (with invariants), the world steps. */
  const tick = () => {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    orders.applyAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
  }
  /** Ticks until w1's script ends, at most `max` ticks. */
  const runOut = (max = 5000) => {
    tick() // the task order applies
    for (let i = 0; i < max && w1.script; i++) tick()
    expect(w1.script).toBeUndefined()
  }
  const give = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'w1', ...order })
  const buildLine = (line: Partial<BuildLine> = LINE) =>
    give({ kind: 'task', task: 'buildLine', ...line })
  const stopped = () => world.events.flatMap((e) => (e.kind === 'scriptStopped' ? [e.reason] : []))
  const roads = () => world.buildings.filter((b) => b.kind === 'road')
  const log = () => (w1.scriptLog ?? []).map((l) => l.text)
  return { world, w1, tick, runOut, give, buildLine, stopped, roads, log }
}

describe('Build line', () => {
  it('builds a 5-tile road line away from the resident, fetching stone when it runs out', () => {
    const s = setup()
    expect(s.buildLine()).toMatchObject({ type: 'ack' })
    s.tick()
    // The line is in task memory alone; Build line has no target param.
    expect(s.w1.script?.memory).toMatchObject({ line: LINE })
    expect(s.w1.scriptParams?.[BUILD_LINE] ?? {}).toEqual({})
    // The Doing line names the line's road or wall (`CONTEXT.md`: Doing).
    expect(seenScript(s.world, s.w1.script!, true)).toMatchObject({ building: 'road' })
    s.runOut()
    expect(s.roads()).toHaveLength(5)
    expect(s.roads().every((b) => !b.site && b.y === 12 && b.x >= 10 && b.x <= 14)).toBe(true)
    // Two tiles' stone carried, three fetched; no more taken than the line needed.
    const left = s.world.buildings.find((b) => b.id === 's1')!.stock!.stone ?? 0
    expect(50 - left - (s.w1.carried.stone ?? 0)).toBe(3 * STONE)
    expect(s.stopped()).toEqual([])
    expect(s.log()).toEqual(
      expect.arrayContaining([
        'laying out a road at 10,12',
        expect.stringMatching(/^fetching \d+ stone at the storage at 12,26$/),
        'the road line is finished',
      ]),
    )
  })

  it('skips tiles that have a road already, or can’t take one', () => {
    const s = setup()
    s.world.buildings.push({ id: 'rd', kind: 'road', cityId: null, x: 12, y: 12 })
    terrain.tiles[12 * SIZE + 13] = Terrain.Lake
    try {
      expect(lineToBuild(s.world, LINE, terrain).map((t) => t.x)).toEqual([10, 11, 14])
      expect(s.buildLine()).toMatchObject({ type: 'ack' })
      s.runOut()
      expect(
        s
          .roads()
          .map((b) => b.x)
          .sort(),
      ).toEqual([10, 11, 12, 14])
      expect(s.stopped()).toEqual([])
    } finally {
      terrain.tiles[12 * SIZE + 13] = Terrain.Plains
    }
  })

  it('with no stone in any storage lays out the whole line as sites and ends, saying why', () => {
    const s = setup({})
    s.w1.carried = { food: OWN_FOOD }
    expect(s.buildLine()).toMatchObject({ type: 'ack' })
    s.runOut()
    const sites = s.roads()
    expect(sites).toHaveLength(5)
    expect(sites.every((b) => b.site)).toBe(true)
    expect(s.stopped()).toEqual(['no stone in any storage'])
  })

  it('started without a line ends: no line given', () => {
    const s = setup()
    expect(s.give({ kind: 'runScript', scriptId: BUILD_LINE })).toMatchObject({ type: 'ack' })
    s.tick()
    expect(s.w1.script).toBeUndefined()
    expect(s.w1.order).toBeNull()
    expect(s.stopped()).toEqual(['no line given'])
  })

  it('is refused for a child, a line of no road or wall, or nothing to build', () => {
    const s = setup()
    expect(s.buildLine({ ...LINE, building: 'house' as 'road' })).toMatchObject({
      reason: 'a line is of road or wall',
    })
    expect(s.buildLine({ building: 'wall', from: LINE.from })).toMatchObject({
      reason: 'the line must run between two tiles',
    })
    for (let x = 10; x <= 14; x++) {
      s.world.buildings.push({ id: `rd${x}`, kind: 'road', cityId: null, x, y: 12 })
    }
    expect(s.buildLine()).toMatchObject({ reason: 'no road to build on that line' })
    s.w1.bornAt = s.world.tick - ticksForAge(5)
    expect(s.buildLine({ ...LINE, building: 'wall' })).toMatchObject({
      reason: 'children can’t build',
    })
  })
})

describe('A crew on one line', () => {
  /** A 9-tile road line, east from (10, 12) to (18, 12). */
  const LONG: BuildLine = { building: 'road', from: { x: 10, y: 12 }, to: { x: 18, y: 12 } }

  it('three residents on a 9-tile line never build the same tile, build all of it and end', () => {
    const s = setup({ stone: 100 })
    s.w1.carried = { food: OWN_FOOD }
    const crew = [s.w1]
    for (const [id, x] of [
      ['w2', 5],
      ['w3', 20],
    ] as const) {
      const r = newResident(mulberry32(crew.length + 1), { id, owner: 'r1', x, y: 20, tick: 0 })
      r.cityId = 'c1'
      r.stats.strength = { base: 10, trained: 0 }
      r.carried = { food: OWN_FOOD }
      s.world.residents.push(r)
      crew.push(r)
    }
    for (const r of crew) {
      expect(s.give({ kind: 'task', task: 'buildLine', ...LONG, residentId: r.id })).toMatchObject({
        type: 'ack',
      })
    }
    // The most of them building a tile of the line at once.
    let atOnce = 0
    for (let i = 0; i < 5000 && crew.some((r) => r.script || i === 0); i++) {
      s.tick()
      // Never two on one tile: what they took, and the tile their build order is on.
      const took = crew.flatMap((r) => {
        const at = r.script?.memory.at as { x: number; y: number } | null | undefined
        return at ? [`${at.x},${at.y}`] : []
      })
      expect(new Set(took).size).toBe(took.length)
      const building = crew.flatMap((r) =>
        r.order?.kind === 'build' ? [`${r.order.at.x},${r.order.at.y}`] : [],
      )
      expect(new Set(building).size).toBe(building.length)
      atOnce = Math.max(atOnce, building.length)
    }
    expect(crew.every((r) => !r.script)).toBe(true)
    expect(s.roads()).toHaveLength(9)
    expect(s.roads().every((b) => !b.site && b.y === 12 && b.x >= 10 && b.x <= 18)).toBe(true)
    expect(atOnce).toBe(3)
    expect(s.stopped()).toEqual([])
    for (const r of crew) {
      expect((r.scriptLog ?? []).map((l) => l.text)).toContain('the road line is finished')
    }
  })
})

describe('line-builders-apart invariant', () => {
  it('flags two residents of a realm on one line who took the same tile', () => {
    const s = setup()
    const w2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 4, y: 20, tick: 0 })
    s.world.residents.push(w2)
    s.w1.script = { scriptId: BUILD_LINE, memory: { line: LINE, at: { x: 12, y: 12 } } }
    w2.script = { scriptId: BUILD_LINE, memory: { line: LINE, at: { x: 13, y: 12 } } }
    expect(lineBuildersApart(s.world, () => 'buildLine')).toEqual([])
    w2.script.memory.at = { x: 12, y: 12 }
    expect(lineBuildersApart(s.world, () => 'buildLine')).toEqual([
      {
        invariant: 'line-builders-apart',
        message: 'w1 and w2 both took (12, 12) of their road line',
        entityIds: ['w1', 'w2'],
      },
    ])
    // Another line, or another realm's resident, may take that tile.
    w2.script.memory.line = { ...LINE, to: { x: 15, y: 12 } }
    expect(lineBuildersApart(s.world, () => 'buildLine')).toEqual([])
    w2.script.memory.line = LINE
    w2.owner = 'r2'
    expect(lineBuildersApart(s.world, () => 'buildLine')).toEqual([])
  })
})

describe('line-builders-on-their-line invariant', () => {
  it('flags a Build line builder who took or builds a tile off their line', () => {
    const s = setup()
    s.w1.script = { scriptId: BUILD_LINE, memory: { line: LINE, at: { x: 12, y: 12 } } }
    expect(lineBuildersOnTheirLine(s.world, () => 'buildLine', SIZE)).toEqual([])
    s.w1.script.memory.at = { x: 12, y: 13 }
    s.w1.order = { kind: 'build', building: 'road', at: { x: 3, y: 3 }, siteId: null }
    expect(lineBuildersOnTheirLine(s.world, () => 'buildLine', SIZE)).toEqual([
      {
        invariant: 'line-builders-on-their-line',
        message: 'w1 took (12, 13), off their road line',
        entityIds: ['w1'],
      },
      {
        invariant: 'line-builders-on-their-line',
        message: 'w1 builds on (3, 3), off their road line',
        entityIds: ['w1'],
      },
    ])
    // Only those running the Build line default count.
    expect(lineBuildersOnTheirLine(s.world, () => 'build', SIZE)).toEqual([])
  })
})
