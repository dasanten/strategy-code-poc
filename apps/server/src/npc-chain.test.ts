import {
  NPC_SMITHY_WEAPON,
  NPC_TOWN,
  NPC_VILLAGE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  canWork,
  cityResidents,
  isArmed,
  npcCityStock,
  npcReserve,
  npcSoldierTarget,
  recipeFor,
  tileIndex,
  type BuildingKind,
  type City,
  type Resident,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, putToWork, stepNpcCities } from './npc-behaviour.js'
import { shortGoods } from './npc-chain.js'
import { foundNpcCity } from './npc-cities.js'
import { chainProject } from './npc-growth.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * The reserve-driven chain (`CONTEXT.md`: NPC city, NPC reserve): spare hands go to the good
 * shortest of the reserve, and the city builds the workplace that makes it, up from the node.
 */

/** The terrain each kind of node lies on here. */
const NODE_TERRAIN: Record<ResourceKind, Terrain> = {
  forest: Terrain.Forest,
  stone: Terrain.Hills,
  ironOre: Terrain.Hills,
  goldOre: Terrain.Mountain,
}

/** A city of `size` alone on a Plains map, with nodes of `kinds` 60 tiles out from its home. */
function cityWith(
  size: typeof NPC_TOWN,
  kinds: ResourceKind[],
): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(300)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, size, 40, 40, mulberry32(5))
  const home = npcHome(world, city)!
  const at = [
    { x: home.x + 60, y: home.y },
    { x: home.x, y: home.y + 60 },
    { x: home.x + 60, y: home.y + 60 },
  ]
  kinds.forEach((kind, i) => {
    const { x, y } = at[i]!
    world.nodes.push({ id: `n-${kind}`, kind, x, y })
    terrain.tiles[tileIndex(terrain.size, x, y)] = NODE_TERRAIN[kind]
  })
  return { world, terrain, city }
}

/** When each kind of workplace first stood finished, by tick. */
type Finished = Partial<Record<BuildingKind, number>>

/** Runs the world a game day at a time, checking the invariants, until `done` or `days` pass. */
function runDays(
  world: WorldState,
  terrain: TerrainMap,
  days: number,
  done: () => boolean,
): Finished {
  const walking = new Walking(terrain)
  const finished: Finished = {}
  for (let day = 0; day < days && !done(); day++) {
    for (let t = 0; t < TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      for (const b of world.buildings) {
        if (!b.site && finished[b.kind] === undefined) finished[b.kind] = world.tick
      }
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  }
  return finished
}

/** The city's adults who carry a weapon, and how many soldiers it keeps. */
function soldiers(world: WorldState, city: City) {
  const adults = cityResidents(world, city).filter((r) => r.health > 0 && canWork(r, world.tick))
  return { armed: adults.filter(isArmed).length, target: npcSoldierTarget(adults.length) }
}

describe('the reserve-driven chain', () => {
  it('wants weapons for its soldiers, and builds up from the node: mine before smelter before smithy', () => {
    const { world, terrain, city } = cityWith(NPC_TOWN, ['forest', 'stone', 'ironOre'])
    const home = npcHome(world, city)!
    // Short of weapons, and the Iron and Wood to forge them.
    expect(npcReserve(world, city)[NPC_SMITHY_WEAPON]).toBeGreaterThan(0)
    expect(shortGoods(world, city)).toEqual(expect.arrayContaining(['spear', 'iron', 'wood']))
    // Weapons want a smithy, which wants Iron, so a smelter, which wants ore: a mine first, and
    // its Wood a lumber camp before that.
    const next = () =>
      chainProject(world, city, home, terrain, undefined, NPC_SMITHY_WEAPON)?.building
    expect(next()).toBe('mine')
    // With its mine on the ore, though no ore in its storage yet, the smelter comes next.
    const ore = world.nodes.find((n) => n.kind === 'ironOre')!
    world.buildings.push({ id: 'mine', kind: 'mine', cityId: null, x: ore.x, y: ore.y })
    city.workplaceIds = [...(city.workplaceIds ?? []), 'mine']
    expect(next()).toBe('smelter')
    // A village with no ore in reach builds nothing for weapons at all.
    const { world: w, terrain: t, city: v } = cityWith(NPC_VILLAGE, ['forest'])
    expect(chainProject(w, v, npcHome(w, v)!, t, undefined, NPC_SMITHY_WEAPON)).toBeUndefined()
  })

  it('a smith takes the Iron and Wood for spears from the storage before setting out', () => {
    const { world, terrain, city } = cityWith(NPC_VILLAGE, ['forest'])
    const storage = npcHome(world, city)!
    const smithy = { id: 'smithy', kind: 'smithy' as const, cityId: null, x: 30, y: 30 }
    world.buildings.push(smithy)
    city.workplaceIds = [...(city.workplaceIds ?? []), smithy.id]
    storage.stock = { food: 200, iron: 3, wood: 100 }
    // Two of them: one farms for both, the other is a spare hand.
    const [farmer, smith] = world.residents.filter((r) => canWork(r, world.tick)) as [
      Resident,
      Resident,
    ]
    world.residents = [farmer, smith]
    putToWork(
      farmer,
      world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!,
    )
    Object.assign(smith, { x: storage.x, y: storage.y, order: null, carried: { food: OWN_FOOD } })
    delete smith.script
    // Spears are short and the storage holds their Iron and Wood: the smithy is worked.
    const plan = planCity(world, city, terrain)
    expect(plan.jobs[smith.id]).toEqual({ kind: 'work', buildingId: smithy.id })
    stepNpcCities(world, terrain.size, terrain)
    // All the Iron there is, and the Wood to go with it.
    const spear = recipeFor('smithy', NPC_SMITHY_WEAPON)!.input
    expect(smith.order).toEqual({
      kind: 'pickUp',
      from: { kind: 'storage', storageId: storage.id },
      goods: { iron: 3 * spear.iron!, wood: 3 * spear.wood! },
    })
    Object.assign(smith.carried, { iron: 3, wood: 6 })
    smith.order = null
    stepNpcCities(world, terrain.size, terrain)
    // Then they set out to make spears, keeping the input on them.
    expect(smith.script?.memory).toMatchObject({ workplaceId: smithy.id, makes: NPC_SMITHY_WEAPON })
    expect(smith.carried).toMatchObject({ iron: 3, wood: 6 })
    // With no Iron in the storage and none on them, nobody is sent.
    Object.assign(smith, { carried: { food: OWN_FOOD }, order: null })
    delete smith.script
    storage.stock = { food: 200, wood: 100 }
    planCity(world, city, terrain)
    stepNpcCities(world, terrain.size, terrain)
    expect(smith.script).toBeUndefined()
  })

  it(
    'a town with forest, stone and iron in reach builds the chain and arms its soldiers with spears it forged',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city } = cityWith(NPC_TOWN, ['forest', 'stone', 'ironOre'])
      const armed = () => {
        const s = soldiers(world, city)
        return world.buildings.some((b) => b.kind === 'smithy' && !b.site) && s.armed >= s.target
      }
      const finished = runDays(world, terrain, 120, armed)
      const order: BuildingKind[] = ['lumberCamp', 'quarry', 'mine', 'smelter', 'smithy']
      for (const kind of order) expect(finished[kind], kind).toBeDefined()
      const ticks = order.map((k) => finished[k]!)
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
      // Its soldiers carry spears: none came from anywhere but its smithy.
      expect(armed()).toBe(true)
      const spears = cityResidents(world, city).filter((r) => (r.carried.spear ?? 0) > 0)
      expect(spears.length).toBeGreaterThanOrEqual(soldiers(world, city).target)
    },
  )

  it(
    'a village with no iron in reach stays short of weapons and is still fed',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city } = cityWith(NPC_VILLAGE, ['forest'])
      const people = cityResidents(world, city).length
      runDays(world, terrain, 30, () => false)
      expect(world.buildings.some((b) => b.kind === 'lumberCamp' && !b.site)).toBe(true)
      for (const kind of ['mine', 'smelter', 'smithy'] as const) {
        expect(world.buildings.some((b) => b.kind === kind)).toBe(false)
      }
      expect(shortGoods(world, city)).toContain(NPC_SMITHY_WEAPON)
      // Fed: nobody starved, and its storages hold Food.
      expect(cityResidents(world, city).filter((r) => r.health > 0).length).toBeGreaterThanOrEqual(
        people,
      )
      expect(npcCityStock(world, city).food ?? 0).toBeGreaterThan(0)
    },
  )
})
