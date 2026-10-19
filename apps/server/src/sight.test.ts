import {
  CHUNK_SIZE,
  SIGHT_RANGE,
  START_HORSES,
  chunksAcross,
  townHallOf,
  wrapDistance,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ExploredTerrain } from './explored.js'
import { SightTracker, entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld } from './world.js'

const terrain = cityTerrain()

describe('entitiesInSight', () => {
  it('shows a Player their city through their residents, and nothing for no realm', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const seen = entitiesInSight(world, terrain, realm.id)
    expect(seen.filter((e) => e.is === 'resident')).toHaveLength(world.residents.length)
    expect(seen.filter((e) => e.is === 'building')).toHaveLength(world.buildings.length)
    expect(seen.filter((e) => e.is === 'city')).toHaveLength(1)
    expect(seen.filter((e) => e.is === 'horse')).toHaveLength(START_HORSES)
    expect(seen.filter((e) => e.is === 'carriage')).toHaveLength(1)
    expect(entitiesInSight(world, terrain, undefined)).toEqual([])
  })

  it('shows only what is within sight range, the Player own things included', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    // Everyone walks off, far from the city: the city and its buildings drop out of sight.
    for (const r of world.residents) Object.assign(r, { x: (r.x + 150) % terrain.size })
    const seen = entitiesInSight(world, terrain, realm.id)
    expect(seen.map((e) => e.is).sort()).toEqual(world.residents.map(() => 'resident'))
    // One comes back to the edge of sight of the storage.
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    Object.assign(world.residents[0]!, { x: storage.x + SIGHT_RANGE, y: storage.y })
    expect(entitiesInSight(world, terrain, realm.id).map((e) => e.id)).toContain(storage.id)
  })

  it('shows piles on the ground within sight range', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const r = world.residents[0]!
    world.piles.push(
      { id: 'near', x: r.x, y: r.y, goods: { wood: 2 } },
      { id: 'far', x: (r.x + 150) % terrain.size, y: r.y, goods: { wood: 2 } },
    )
    const piles = entitiesInSight(world, terrain, realm.id).filter((e) => e.is === 'pile')
    expect(piles.map((p) => p.id)).toEqual(['near'])
  })

  it('lets two Players far apart see nothing of each other', () => {
    const world = createWorld(terrain)
    foundStartingCity(world, terrain, 1)
    foundStartingCity(world, terrain, 2)
    const [a, b] = world.realms as [(typeof world.realms)[0], (typeof world.realms)[0]]
    const [ca, cb] = world.cities
    expect(
      wrapDistance(terrain.size, townHallOf(world, ca!)!, townHallOf(world, cb!)!),
    ).toBeGreaterThan(SIGHT_RANGE * 3)
    const ownedBy = (realmId: string) =>
      new Set(
        [
          ...world.residents.filter((r) => r.owner === realmId),
          ...world.cities.filter((c) => c.realmId === realmId),
          ...world.horses.filter((h) => h.realmId === realmId),
          ...world.carriages.filter((k) => k.realmId === realmId),
          ...world.buildings.filter(
            (x) => world.cities.find((c) => c.id === x.cityId)?.realmId === realmId,
          ),
        ].map((e) => e.id),
      )
    for (const [me, them] of [
      [a, b],
      [b, a],
    ] as const) {
      const theirs = ownedBy(them.id)
      const seen = entitiesInSight(world, terrain, me.id)
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.filter((e) => theirs.has(e.id))).toEqual([])
    }
  })

  it('sees across a join of the map', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const [watcher, walker] = world.residents as [
      (typeof world.residents)[0],
      (typeof world.residents)[0],
    ]
    Object.assign(watcher, { x: 1, y: 100 })
    Object.assign(walker, { x: terrain.size - 3, y: 100, owner: 'someone-else' })
    expect(entitiesInSight(world, terrain, realm.id).map((e) => e.id)).toContain(walker.id)
  })
})

describe('SightTracker', () => {
  it('explores around residents, again only when they reach a new tile', () => {
    const { world } = worldWithCity()
    const explored = new ExploredTerrain(terrain)
    const sight = new SightTracker()
    const userId = world.realms[0]!.userId
    const first = sight.update(world, explored)
    expect(first.get(userId)?.size).toBeGreaterThan(0)
    const r = world.residents[0]!
    expect(explored.isExplored({ id: userId }, r.x + SIGHT_RANGE, r.y)).toBe(true)
    expect(explored.isExplored({ id: userId }, r.x + SIGHT_RANGE * 4, r.y)).toBe(false)

    // Nobody moved: nothing new.
    expect(sight.update(world, explored)).toEqual(new Map())

    // One walks far off: the chunks around them are newly explored.
    Object.assign(r, { x: (r.x + 100) % terrain.size })
    const grown = sight.update(world, explored).get(userId)!
    const n = chunksAcross(terrain.size)
    expect(grown).toContain(Math.floor(r.y / CHUNK_SIZE) * n + Math.floor(r.x / CHUNK_SIZE))
    expect(explored.isExplored({ id: userId }, r.x, r.y)).toBe(true)
  })
})
