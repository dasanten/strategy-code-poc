import {
  Terrain,
  warehousePrices,
  type Realm,
  type TerrainMap,
  type WorldState,
  footprintTiles,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { lastSeenInSight, lastSeenOutOfSight, stepLastSeen } from './last-seen.js'
import { mulberry32 } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { cityTerrain } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { createWorld } from './world.js'

const terrain = cityTerrain()

/** Ticks on and brings Last seen up to date, as the end of `stepWorld` does. */
function step(world: WorldState, map: TerrainMap = terrain) {
  world.tick++
  stepLastSeen(world, map.size)
}

/** The ids a Player remembers out of their sight now. */
const outOfSight = (world: WorldState, userId: number) =>
  new Set(lastSeenOutOfSight(world, userId).map((e) => e.id))

/**
 * Mara (Player 1) and Tobin (Player 2) far apart; Tobin's scout stands near Mara's storage, and
 * `home` sends a resident back among their own city.
 */
function twoRealms() {
  const world = createWorld(terrain)
  foundStartingCity(world, terrain, 1)
  foundStartingCity(world, terrain, 2)
  const [mara, tobin] = world.realms as [Realm, Realm]
  const city = world.cities.find((c) => c.realmId === mara.id)!
  const storage = world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!
  const scout = world.residents.find((r) => r.owner === tobin.id)!
  Object.assign(scout, { x: storage.x + 3, y: storage.y + 3, order: null })
  const home = world.residents.find((r) => r.owner === tobin.id && r !== scout)!
  const goHome = () => Object.assign(scout, { x: home.x, y: home.y })
  const hers = () => new Set(world.buildings.filter((b) => b.cityId === city.id).map((b) => b.id))
  return { world, mara, tobin, city, storage, scout, goHome, hers }
}

describe('Last seen (`CONTEXT.md`)', () => {
  it('keeps a stranger’s city as it was seen, without what is inside, once it leaves sight', () => {
    const { world, tobin, city, storage, goHome, hers } = twoRealms()
    step(world)
    const seenThen = entitiesInSight(world, terrain, tobin.id).find((e) => e.id === storage.id)
    const seenAt = world.tick
    goHome()
    step(world)
    const remembered = lastSeenOutOfSight(world, 2)
    expect(remembered.find((e) => e.id === storage.id)).toEqual({ ...seenThen, seenAt })
    expect(remembered.find((e) => e.id === storage.id)).not.toHaveProperty('stock')
    expect(remembered.find((e) => e.id === city.id)).toMatchObject({ is: 'city', seenAt })
    // Everything of hers he saw is remembered, and only buildings and the city.
    const ids = outOfSight(world, 2)
    expect([...hers()].filter((id) => !ids.has(id))).toEqual([])
    expect(new Set(remembered.map((e) => e.is))).toEqual(new Set(['building', 'city']))
  })

  it('keeps what is inside when it was seen: at the storage, and for the Player’s own', () => {
    const { world, mara, storage, scout, goHome } = twoRealms()
    // Tobin's scout on a tile of the storage sees inside it.
    const [fx, fy] = footprintTiles(storage, terrain.size)[0]!
    Object.assign(scout, { x: fx, y: fy })
    step(world)
    goHome()
    // Everyone of Mara's walks far off: her own city leaves her sight.
    for (const r of world.residents.filter((x) => x.owner === mara.id)) {
      Object.assign(r, { x: (r.x + 400) % terrain.size })
    }
    step(world)
    const stock = structuredClone(storage.stock)
    for (const userId of [1, 2]) {
      expect(lastSeenOutOfSight(world, userId).find((e) => e.id === storage.id)).toMatchObject({
        stock,
      })
    }
  })

  it('keeps a Trade Org warehouse with its prices, not what it holds', () => {
    const size = 640
    const plains: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
    const world = createWorld(plains)
    foundTradeOrgHq(world, plains, 320, 320, mulberry32(7))
    const realm = foundStartingCity(world, plains, 1)
    const scout = world.residents.find((r) => r.owner === realm.id)!
    const warehouse = world.buildings.find(
      (b) => b.kind === 'warehouse' && warehousePrices(world, b).length > 0,
    )!
    Object.assign(scout, { x: warehouse.x + 8, y: warehouse.y + 8, order: null })
    step(world, plains)
    Object.assign(scout, { x: (warehouse.x + 300) % size })
    step(world, plains)
    const remembered = lastSeenOutOfSight(world, 1).find((e) => e.id === warehouse.id)
    expect(remembered).not.toHaveProperty('stock')
    expect(remembered?.is === 'building' && remembered.prices?.length).toBeGreaterThan(0)
    for (const line of (remembered?.is === 'building' && remembered.prices) || []) {
      expect(line).not.toHaveProperty('stock')
    }
  })

  it('stays as it was while out of sight, then shows what is there now or forgets it', () => {
    const { world, storage, scout, goHome, hers } = twoRealms()
    const back = { x: scout.x, y: scout.y }
    step(world)
    goHome()
    step(world)
    const before = lastSeenOutOfSight(world, 2)
    // Out of his sight her storage fills and a house of hers is torn down.
    storage.stock = { ...storage.stock, wood: (storage.stock?.wood ?? 0) + 50 }
    const house = world.buildings.find((b) => hers().has(b.id) && b.kind === 'house')!
    world.buildings = world.buildings.filter((b) => b !== house)
    step(world)
    expect(lastSeenOutOfSight(world, 2)).toEqual(before)
    // His scout comes back: what is there now, and the house is forgotten.
    Object.assign(scout, back)
    step(world)
    const now = world.lastSeen[2]!
    expect(now.find((e) => e.id === house.id)).toBeUndefined()
    expect(now.find((e) => e.id === storage.id)).toMatchObject({ seenAt: world.tick })
    expect(lastSeenOutOfSight(world, 2).some((e) => e.id === storage.id)).toBe(false)
  })

  it('keeps what was inside as it was while the world changes it in place', () => {
    const { world, mara, storage } = twoRealms()
    step(world)
    for (const r of world.residents.filter((x) => x.owner === mara.id)) {
      Object.assign(r, { x: (r.x + 400) % terrain.size })
    }
    step(world)
    const before = structuredClone(lastSeenOutOfSight(world, 1))
    expect(before.find((e) => e.id === storage.id)).toHaveProperty('stock')
    // Out of her sight her storage's stock changes as the simulation changes it: in place.
    storage.stock!.wood = (storage.stock!.wood ?? 0) + 50
    step(world)
    expect(lastSeenOutOfSight(world, 1)).toEqual(before)
  })

  it('forgets a city once none of its buildings is remembered', () => {
    const { world, city, scout, goHome, hers } = twoRealms()
    const back = { x: scout.x, y: scout.y }
    step(world)
    goHome()
    step(world)
    expect(outOfSight(world, 2)).toContain(city.id)
    const gone = hers()
    world.buildings = world.buildings.filter((b) => !gone.has(b.id))
    world.cities = world.cities.filter((c) => c !== city)
    Object.assign(scout, back)
    step(world)
    const ids = new Set(world.lastSeen[2]!.map((e) => e.id))
    expect([...gone, city.id].filter((id) => ids.has(id))).toEqual([])
  })

  it('grows only from sight: joining an alliance hands nothing over, leaving keeps it', () => {
    const { world, mara, tobin, city, goHome, hers } = twoRealms()
    goHome()
    // Mara's residents walk off: she remembers her city, out of her sight now.
    const herPeople = world.residents.filter((r) => r.owner === mara.id)
    const homes = herPeople.map((r) => ({ x: r.x, y: r.y }))
    step(world)
    for (const r of herPeople) Object.assign(r, { x: (r.x + 400) % terrain.size })
    step(world)
    expect(outOfSight(world, 1)).toContain(city.id)
    const alliance = {
      id: 'alliance-1',
      name: 'North',
      leaderId: mara.id,
      members: [mara, tobin].map((r) => ({ realmId: r.id, joinedAt: 0, leaving: null })),
      invites: [],
      army: [],
    }
    world.alliances.push(alliance)
    step(world)
    const tobins = new Set((world.lastSeen[2] ?? []).map((e) => e.id))
    expect([...hers(), city.id].filter((id) => tobins.has(id))).toEqual([])
    // Back home, Mara's people let Tobin see her city through the alliance; then it ends.
    herPeople.forEach((r, i) => Object.assign(r, homes[i]))
    step(world)
    world.alliances = []
    step(world)
    expect(outOfSight(world, 2)).toContain(city.id)
  })

  it('records only what the Player is allowed to see at that moment', () => {
    const { world, tobin, scout, goHome } = twoRealms()
    const walk = [
      { x: scout.x, y: scout.y },
      { x: scout.x - 2, y: scout.y - 2 },
    ]
    for (const at of walk) {
      Object.assign(scout, at)
      step(world)
      const seen = new Map(entitiesInSight(world, terrain, tobin.id).map((e) => [e.id, e]))
      for (const { seenAt, ...e } of world.lastSeen[2]!) {
        if (seenAt === world.tick) expect(e).toEqual(seen.get(e.id))
      }
    }
    goHome()
    step(world)
    expect(lastSeenOutOfSight(world, 2).length).toBeGreaterThan(0)
  })

  it('flags, as an invariant, Last seen sent while it is in sight', () => {
    const { world, tobin, storage, goHome } = twoRealms()
    step(world)
    const inSight = world.lastSeen[2]!
    expect(lastSeenInSight(world, terrain, tobin.id, inSight).map((v) => v.entityIds[0])).toContain(
      storage.id,
    )
    goHome()
    step(world)
    expect(lastSeenInSight(world, terrain, tobin.id, lastSeenOutOfSight(world, 2))).toEqual([])
  })
})
