import {
  Terrain,
  inCityArea,
  terrainAt,
  townHallOf,
  wrapDistance,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, ownersExist } from './invariants.js'
import { runByNpcCity } from './npc-behaviour.js'
import { mulberry32, newResident } from './residents.js'
import { endRealm } from './survival.js'
import { addCity, worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

/** A free Plains tile at least `far` tiles from every town hall, for a second city's town hall. */
function freePlains(world: WorldState, terrain: TerrainMap, far: number) {
  const size = terrain.size
  const halls = world.buildings.filter((b) => b.kind === 'townHall')
  const taken = new Set(world.buildings.map((b) => `${b.x},${b.y}`))
  for (const n of world.nodes) taken.add(`${n.x},${n.y}`)
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      if (terrainAt(terrain, x, y) !== Terrain.Plains || taken.has(`${x},${y}`)) continue
      if (halls.every((h) => wrapDistance(size, h, { x, y }) >= far)) return { x, y }
    }
  }
  throw new Error('no free Plains')
}

/** Player 1's starting city and a second city of their realm far from it. */
function twoCities() {
  const { world, terrain } = worldWithCity()
  const realm = world.realms[0]!
  const first = world.cities[0]!
  const second = addCity(world, {
    id: 'city-second',
    realmId: realm.id,
    ...freePlains(world, terrain, 40),
    name: 'Redbank',
  })
  return { world, terrain, realm, first, second }
}

const hallOf = (world: WorldState, city: City) => townHallOf(world, city)!

describe('a dead Leader’s cities become self-managed', () => {
  it('turns each city into its own NPC city, with its residents, horses and carriages', () => {
    const { world, terrain, realm, first, second } = twoCities()
    const hall = hallOf(world, second)
    // One resident lives in the second city, one more is homeless next to it.
    const settler = world.residents.find((r) => r.id !== realm.leaderId)!
    Object.assign(settler, { cityId: second.id, x: hall.x + 1, y: hall.y, order: null })
    const homeless = newResident(mulberry32(3), {
      id: 'homeless',
      owner: realm.id,
      x: hall.x,
      y: hall.y + 1,
      tick: 0,
    })
    world.residents.push(homeless)
    // A horse and the carriage stand next to the second city; the other horse stays home.
    const [nearSecond, atHome] = world.horses
    Object.assign(nearSecond!, { x: hall.x - 1, y: hall.y })
    const carriage = world.carriages[0]!
    Object.assign(carriage, { x: hall.x - 1, y: hall.y, horseId: null })
    const firstResidents = world.residents.filter((r) => r.cityId === first.id).map((r) => r.id)

    endRealm(world, realm, terrain.size)

    expect(world.realms).toEqual([])
    for (const c of [first, second]) expect(c.realmId).toBeNull()
    for (const r of world.residents) {
      expect(r.owner).toBeNull()
      expect(runByNpcCity(world, r)).toBe(true)
    }
    expect(world.residents.filter((r) => r.cityId === first.id).map((r) => r.id)).toEqual(
      firstResidents.filter((id) => id !== settler.id),
    )
    expect(settler.cityId).toBe(second.id)
    expect(homeless.cityId).toBe(second.id)
    expect(nearSecond).toMatchObject({ realmId: null, cityId: second.id })
    expect(atHome).toMatchObject({ realmId: null, cityId: first.id })
    expect(carriage).toMatchObject({ realmId: null, cityId: second.id })
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
  })

  it('sends residents away home, leaves workers on their city’s farm and ends Player-only orders', () => {
    const { world, terrain, realm, first, second } = twoCities()
    const hall = hallOf(world, first)
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === first.id)!
    const [away, worker, builder] = world.residents.filter((r) => r.cityId === first.id)
    // Out by the second city, on a Player's errand.
    const far = hallOf(world, second)
    Object.assign(away!, { x: far.x + 1, y: far.y, order: null })
    away!.order = { kind: 'walkTo', target: { x: far.x + 2, y: far.y }, path: null, progress: 0 }
    Object.assign(worker!, { x: farm.x, y: farm.y })
    worker!.order = {
      kind: 'workAt',
      buildingId: farm.id,
      at: { x: farm.x, y: farm.y },
      progress: 0,
    }
    const work = structuredClone(worker!.order)
    Object.assign(builder!, { x: hall.x, y: hall.y + 1 })
    builder!.order = {
      kind: 'drive',
      carriageId: 'k0',
      target: { x: 0, y: 0 },
      path: null,
      progress: 0,
    }

    endRealm(world, realm, terrain.size)

    expect(away!.order).toMatchObject({ kind: 'walkTo' })
    const target = (away!.order as { target: { x: number; y: number } }).target
    expect(inCityArea(world, first, target.x, target.y, terrain.size)).toBe(true)
    expect(worker!.order).toEqual(work)
    expect(builder!.order).toBeNull()
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])

    // The one away does get home, on their own.
    const walking = new Walking(terrain)
    for (let t = 0; t < 20000 && !inCityArea(world, first, away!.x, away!.y, terrain.size); t++) {
      stepWorld(world, terrain, walking)
    }
    expect(inCityArea(world, first, away!.x, away!.y, terrain.size)).toBe(true)
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
  })

  it('tells the Player what became of each city, and where it stands', () => {
    const { world, terrain, realm, first, second } = twoCities()
    const settler = world.residents.find((r) => r.id !== realm.leaderId)!
    settler.cityId = second.id
    const living = (c: City) => world.residents.filter((r) => r.cityId === c.id).length

    endRealm(world, realm, terrain.size)

    const [h1, h2] = [hallOf(world, first), hallOf(world, second)]
    expect(world.events.at(-1)).toMatchObject({
      kind: 'selfManaged',
      userId: realm.userId,
      cities: [
        { cityId: first.id, name: first.name, x: h1.x, y: h1.y, residents: living(first) },
        { cityId: second.id, name: 'Redbank', x: h2.x, y: h2.y, residents: 1 },
      ],
    })
  })

  it('leaves everything to nobody when the realm has no city left', () => {
    const { world, terrain } = worldWithCity()
    const realm = world.realms[0]!
    world.cities = []
    for (const b of world.buildings) b.cityId = null
    for (const r of world.residents) r.cityId = null
    world.buildings = world.buildings.filter((b) => b.kind !== 'townHall')

    endRealm(world, realm, terrain.size)

    for (const r of world.residents) expect(r).toMatchObject({ owner: null, cityId: null })
    for (const k of [...world.horses, ...world.carriages]) {
      expect(k).toMatchObject({ realmId: null, cityId: null })
    }
    expect(ownersExist.check(world, terrain)).toEqual([])
    expect(world.events.at(-1)).toMatchObject({ kind: 'selfManaged', cities: [] })
  })

  it('a Leader dying in the world leaves nothing belonging to the ended realm', () => {
    const { world, terrain, realm } = twoCities()
    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    leader.health = 0
    leader.hunger = 0
    leader.carried = {}
    stepWorld(world, terrain)
    expect(world.realms).toEqual([])
    expect(ownersExist.check(world, terrain)).toEqual([])
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
  })

  it('catches anything left belonging to an ended realm, or to a city it cannot belong to', () => {
    const { world, terrain, realm, first } = twoCities()
    world.realms = []
    world.horses[0]!.cityId = first.id
    const found = ownersExist.check(world, terrain)
    const ids = new Set(found.map((v) => v.entityIds[0]))
    for (const r of world.residents) expect(ids.has(r.id)).toBe(true)
    for (const c of world.cities) expect(ids.has(c.id)).toBe(true)
    expect(found.filter((v) => v.entityIds[0] === world.horses[0]!.id)).toHaveLength(2)
    expect(found[0]!.message).toContain(realm.id)
  })
})
