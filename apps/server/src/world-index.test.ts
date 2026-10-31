import {
  buildingAt,
  commanderOf,
  roadTiles,
  type Alliance,
  type MercenaryContract,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { newHorse } from './horses.js'
import { mulberry32, newResident } from './residents.js'
import { generateTerrain } from './terrain-gen.js'
import { generateWorld } from './world.js'
import { worldIndex } from './world-index.js'

/**
 * A generated world with every NPC city placed, then, drawn from `seed`: horses, roads (one a
 * site), a building across the map's join, alliance armies and mercenary contracts, some started
 * and some sharing residents, so every way `commanderOf` can answer comes up.
 */
function busyWorld(terrain: TerrainMap, seed: number): WorldState {
  const world = generateWorld(terrain, seed)
  const rand = mulberry32(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!
  const size = terrain.size
  for (let i = 0; i < 20; i++) {
    const r = pick(world.residents)
    world.horses.push(
      newHorse(rand, { id: `h${i}`, realmId: null, cityId: r.cityId, x: r.x, y: r.y, tick: 0 }),
    )
  }
  const sample = pick(world.buildings)
  for (let i = 0; i < 30; i++) {
    const r = pick(world.residents)
    world.buildings.push({
      ...sample,
      id: `road${i}`,
      kind: 'road',
      x: r.x,
      y: r.y,
      ...(i % 5 === 0 ? { site: { delivered: {}, work: 0 } } : {}),
    })
  }
  world.buildings.push({ ...sample, id: 'across', kind: 'storage', x: size - 1, y: size - 1 })
  for (let i = 0; i < 4; i++) {
    world.residents.push(
      newResident(rand, { id: `p${i}`, owner: `realm${i}`, x: 0, y: 0, tick: 0 }),
    )
  }
  const ids = () => Array.from({ length: 6 }, () => pick(world.residents).id)
  for (let i = 0; i < 3; i++) {
    const alliance: Alliance = {
      id: `a${i}`,
      name: `A${i}`,
      leaderId: `realm${i}`,
      members: [],
      invites: [],
      army: [],
    }
    for (const id of ids()) alliance.army.push({ is: 'resident', id, recallAt: null })
    alliance.army.push({ is: 'carriage', id: pick(world.carriages).id, recallAt: null })
    world.alliances.push(alliance)
  }
  for (let i = 0; i < 4; i++) {
    const contract: MercenaryContract = {
      id: `c${i}`,
      lenderId: 'lender',
      hirerId: `hirer${i}`,
      offeredBy: 'lender',
      residentIds: ids(),
      days: 7,
      pricePerWeek: 1,
      storageId: sample.id,
      startedAt: i === 3 ? null : 0,
      paidWeeks: 0,
    }
    world.contracts.push(contract)
  }
  return world
}

describe('worldIndex', () => {
  let terrain: TerrainMap
  beforeAll(() => {
    terrain = generateTerrain(1, 2880)
  })

  it('agrees with the scans it replaces on generated worlds', () => {
    for (const seed of [1, 2, 3]) {
      const world = busyWorld(terrain, seed)
      const size = terrain.size
      const index = worldIndex(world)
      for (const r of world.residents) {
        expect(index.residentById(r.id)).toBe(world.residents.find((x) => x.id === r.id))
        expect(index.commanderOf(r)).toBe(commanderOf(world, r))
      }
      for (const b of world.buildings)
        expect(index.buildingById(b.id)).toBe(world.buildings.find((x) => x.id === b.id))
      for (const k of world.carriages) expect(index.carriageById(k.id)).toBe(k)
      for (const h of world.horses) expect(index.horseById(h.id)).toBe(h)
      expect(index.residentById('nobody')).toBeUndefined()
      // Every tile of every footprint and around it, the map's join included, and random tiles.
      const rand = mulberry32(seed)
      const tiles: [number, number][] = []
      for (const b of world.buildings) {
        for (let dy = -1; dy <= 3; dy++) {
          for (let dx = -1; dx <= 3; dx++)
            tiles.push([(b.x + dx + size) % size, (b.y + dy + size) % size])
        }
      }
      for (let i = 0; i < 2000; i++)
        tiles.push([Math.floor(rand() * size), Math.floor(rand() * size)])
      for (const [x, y] of tiles)
        expect(index.buildingAt(x, y, size)).toBe(buildingAt(world, x, y, size))
      expect(index.roads(size)).toEqual(roadTiles(world, size))
      expect(index.roads(size).size).toBeGreaterThan(0)
    }
  })

  it('is the same index while nothing it reads has changed', () => {
    const world = busyWorld(terrain, 4)
    const index = worldIndex(world)
    world.residents[0]!.x++
    expect(worldIndex(world)).toBe(index)
    world.tick++
    expect(worldIndex(world)).not.toBe(index)
  })

  it('is built again after a push and after a filter', () => {
    const world = busyWorld(terrain, 5)
    const added = newResident(mulberry32(1), {
      id: 'newcomer',
      owner: 'realmX',
      x: 1,
      y: 1,
      tick: 0,
    })
    expect(worldIndex(world).residentById('newcomer')).toBeUndefined()
    world.residents.push(added)
    expect(worldIndex(world).residentById('newcomer')).toBe(added)
    world.residents = world.residents.filter((r) => r !== added)
    expect(worldIndex(world).residentById('newcomer')).toBeUndefined()

    const storage = world.buildings.find((b) => b.id === 'across')!
    expect(worldIndex(world).buildingAt(0, 0, terrain.size)).toBe(storage)
    world.buildings = world.buildings.filter((b) => b !== storage)
    expect(worldIndex(world).buildingAt(0, 0, terrain.size)).toBe(
      buildingAt(world, 0, 0, terrain.size),
    )
  })

  it('follows who commands a resident as armies and contracts change', () => {
    const world = busyWorld(terrain, 6)
    const r = newResident(mulberry32(2), { id: 'loner', owner: 'realm0', x: 1, y: 1, tick: 0 })
    world.residents.push(r)
    expect(worldIndex(world).commanderOf(r)).toBe('realm0')
    world.contracts[0]!.residentIds = [...world.contracts[0]!.residentIds, r.id]
    expect(worldIndex(world).commanderOf(r)).toBe(commanderOf(world, r))
    world.alliances[1]!.army.push({ is: 'resident', id: r.id, recallAt: null })
    expect(worldIndex(world).commanderOf(r)).toBe('realm1')
    world.alliances[1]!.army = world.alliances[1]!.army.filter((p) => p.id !== r.id)
    expect(worldIndex(world).commanderOf(r)).toBe('hirer0')
    world.contracts[0]!.startedAt = null
    expect(worldIndex(world).commanderOf(r)).toBe('realm0')
    // The owner is read as it is now.
    r.owner = 'realmY'
    expect(worldIndex(world).commanderOf(r)).toBe('realmY')
  })
})
