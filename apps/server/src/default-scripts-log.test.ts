import {
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  Terrain,
  type Building,
  type Resident,
  type Task,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * The defaults' script log (`CONTEXT.md`: Script log): the game's default scripts log their
 * decisions and turns, such as carrying a load off or getting Food, never every tick.
 */

const SIZE = 32
const SCRIPT = 1

/** Mara's realm r1 with city c1 at (14, 10), a lumber camp at (6, 10) and storage s1 at (12, 10). */
function campWorld(): { world: WorldState; terrain: TerrainMap; camp: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 14, y: 10 })
  const at = { x: 6, y: 10 }
  terrain.tiles[at.y * SIZE + at.x] = Terrain.Forest
  world.nodes.push({ id: 'n', kind: 'forest', ...at })
  const camp: Building = { id: 'camp', kind: 'lumberCamp', cityId: null, ...at }
  world.buildings.push(camp)
  world.buildings.push({
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: 12,
    y: 10,
    stock: { food: 50 },
  })
  return { world, terrain, camp }
}

function addWorker(world: WorldState, camp: Building, food: number): Resident {
  const r = newResident(mulberry32(1), {
    id: 'w1',
    owner: 'r1',
    cityId: 'c1',
    x: camp.x,
    y: camp.y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food }
  r.order = { kind: 'workAt', buildingId: camp.id, at: { x: camp.x, y: camp.y }, progress: 0 }
  r.script = { scriptId: SCRIPT, memory: { workplaceId: camp.id } }
  r.scriptParams = { [SCRIPT]: { foodAt: 4, foodTake: 12, crewFood: 0 } }
  world.residents.push(r)
  return r
}

const hostOf = (task: Task): ScriptHost => ({
  script: () => ({
    userId: 1,
    name: DEFAULT_SCRIPTS[task].name,
    version: 1,
    source: DEFAULT_SCRIPTS[task].source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
})

/** Runs the world with the resident never hungry until `done` or the ticks run out. */
function run(
  world: WorldState,
  terrain: TerrainMap,
  w: Resident,
  done: () => boolean,
  ticks = 400,
) {
  const runner = new ScriptRunner(terrain, hostOf('work'))
  const walking = new Walking(terrain)
  let ran = 0
  for (; ran < ticks && !done(); ran++) {
    w.hunger = MAX_HUNGER
    expect(runner.runAll(world, true)).toEqual([])
    stepWorld(world, terrain, walking)
  }
  return ran
}

const lines = (r: Resident) => (r.scriptLog ?? []).map((l) => l.text)

describe('the Work default’s log', () => {
  it('logs once when getting Food and once when carrying a load off, not every tick', () => {
    const { world, terrain, camp } = campWorld()
    const w = addWorker(world, camp, 3)
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    let carried = false
    const ticks = run(world, terrain, w, () => {
      carried ||= Boolean(w.script?.memory.carry)
      return carried && !w.script?.memory.carry
    })
    expect(carried).toBe(true)
    expect(ticks).toBeGreaterThan(10)
    const [food, carry, ...more] = lines(w)
    expect(food).toBe('low on Food (3): fetching 9 at the storage at 12,10')
    expect(carry).toMatch(/^pile full: carrying \d+ wood to the storage at 12,10$/)
    expect(more).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('logs nothing while it just works', () => {
    const { world, terrain, camp } = campWorld()
    const w = addWorker(world, camp, 12)
    expect(run(world, terrain, w, () => false, 50)).toBe(50)
    expect(w.order).toMatchObject({ kind: 'workAt' })
    expect(lines(w)).toEqual([])
  })
})
