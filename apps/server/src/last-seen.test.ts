import {
  LAST_SEEN_EVERY_TICKS,
  Terrain,
  warehousePrices,
  type Realm,
  type TerrainMap,
  type WorldState,
  footprintTiles,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  lastSeenInSight,
  lastSeenOnCadence,
  lastSeenOutOfSight,
  lastSeenRefreshedAt,
  lastSeenTurn,
  refreshLastSeen,
  refreshLastSeenSoon,
  stepLastSeen,
} from './last-seen.js'
import { mulberry32 } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { cityTerrain } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { createWorld } from './world.js'

const terrain = cityTerrain()

/** Ticks on and brings every realm's Last seen up to date, as the end of `stepWorld` does on its turn. */
function step(world: WorldState, map: TerrainMap = terrain) {
  world.tick++
  refreshLastSeen(world, map.size)
}

/** The ids a Player remembers out of their sight now. */
const outOfSight = (world: WorldState, userId: number) =>
  new Set(lastSeenOutOfSight(world, terrain.size, userId).map((e) => e.id))

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
    const remembered = lastSeenOutOfSight(world, terrain.size, 2)
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
      expect(
        lastSeenOutOfSight(world, terrain.size, userId).find((e) => e.id === storage.id),
      ).toMatchObject({
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
    const remembered = lastSeenOutOfSight(world, size, 1).find((e) => e.id === warehouse.id)
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
    const before = lastSeenOutOfSight(world, terrain.size, 2)
    // Out of his sight her storage fills and a house of hers is torn down.
    storage.stock = { ...storage.stock, wood: (storage.stock?.wood ?? 0) + 50 }
    const house = world.buildings.find((b) => hers().has(b.id) && b.kind === 'house')!
    world.buildings = world.buildings.filter((b) => b !== house)
    step(world)
    expect(lastSeenOutOfSight(world, terrain.size, 2)).toEqual(before)
    // His scout comes back: what is there now, and the house is forgotten.
    Object.assign(scout, back)
    step(world)
    const now = world.lastSeen[2]!
    expect(now.find((e) => e.id === house.id)).toBeUndefined()
    expect(now.find((e) => e.id === storage.id)).toMatchObject({ seenAt: world.tick })
    expect(lastSeenOutOfSight(world, terrain.size, 2).some((e) => e.id === storage.id)).toBe(false)
  })

  it('keeps what was inside as it was while the world changes it in place', () => {
    const { world, mara, storage } = twoRealms()
    step(world)
    for (const r of world.residents.filter((x) => x.owner === mara.id)) {
      Object.assign(r, { x: (r.x + 400) % terrain.size })
    }
    step(world)
    const before = structuredClone(lastSeenOutOfSight(world, terrain.size, 1))
    expect(before.find((e) => e.id === storage.id)).toHaveProperty('stock')
    // Out of her sight her storage's stock changes as the simulation changes it: in place.
    storage.stock!.wood = (storage.stock!.wood ?? 0) + 50
    step(world)
    expect(lastSeenOutOfSight(world, terrain.size, 1)).toEqual(before)
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
    expect(lastSeenOutOfSight(world, terrain.size, 2).length).toBeGreaterThan(0)
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
    expect(
      lastSeenInSight(world, terrain, tobin.id, lastSeenOutOfSight(world, terrain.size, 2)),
    ).toEqual([])
  })
})

describe('Last seen on a cadence (`CONTEXT.md`: Last seen)', () => {
  /** Ticks on to the realm's next turn, bringing Last seen up to date as `stepWorld` does. */
  function untilTurn(world: WorldState, realmId: string) {
    do {
      world.tick++
      stepLastSeen(world, terrain.size)
    } while (!lastSeenTurn(world, realmId))
  }

  it('comes round once every `LAST_SEEN_EVERY_TICKS` for each realm, staggered by id', () => {
    const world = createWorld(terrain)
    const ids = Array.from({ length: 20 }, (_, i) => `realm-${i}`)
    const offsets = new Set<number>()
    for (const id of ids) {
      const turns: number[] = []
      for (let t = 0; t < 3 * LAST_SEEN_EVERY_TICKS; t++) {
        world.tick = t
        if (lastSeenTurn(world, id)) turns.push(t)
      }
      expect(turns).toHaveLength(3)
      expect(turns[1]! - turns[0]!).toBe(LAST_SEEN_EVERY_TICKS)
      offsets.add(turns[0]!)
    }
    expect(offsets.size).toBeGreaterThan(1)
  })

  it('updates a realm’s Last seen on its turn only', () => {
    const { world, tobin, city } = twoRealms()
    untilTurn(world, tobin.id)
    const refreshed = world.tick
    expect(lastSeenRefreshedAt(world, tobin.id)).toBe(refreshed)
    for (let i = 1; i < LAST_SEEN_EVERY_TICKS; i++) {
      world.tick++
      stepLastSeen(world, terrain.size)
      expect(lastSeenRefreshedAt(world, tobin.id)).toBe(refreshed)
      expect(world.lastSeen[2]!.find((e) => e.id === city.id)?.seenAt).toBe(refreshed)
    }
    world.tick++
    stepLastSeen(world, terrain.size)
    expect(lastSeenRefreshedAt(world, tobin.id)).toBe(refreshed + LAST_SEEN_EVERY_TICKS)
    expect(world.lastSeen[2]!.find((e) => e.id === city.id)?.seenAt).toBe(world.tick)
  })

  it('remembers a building that leaves sight between two refreshes as it was at the last one', () => {
    const { world, tobin, city, storage, goHome } = twoRealms()
    untilTurn(world, tobin.id)
    const atRefresh = entitiesInSight(world, terrain, tobin.id).find((e) => e.id === city.id)
    const refreshed = world.tick
    // In his sight her city is renamed, then his scout leaves before his next turn.
    city.name = 'Ironhold'
    world.tick++
    stepLastSeen(world, terrain.size)
    goHome()
    world.tick++
    stepLastSeen(world, terrain.size)
    expect(lastSeenTurn(world, tobin.id)).toBe(false)
    const remembered = lastSeenOutOfSight(world, terrain.size, 2)
    expect(remembered.find((e) => e.id === city.id)).toEqual({ ...atRefresh, seenAt: refreshed })
    expect(remembered.find((e) => e.id === storage.id)).toMatchObject({ seenAt: refreshed })
  })

  it('never sends what is in sight now as Last seen, refreshed or not', () => {
    const { world, tobin, storage, scout, goHome } = twoRealms()
    const back = { x: scout.x, y: scout.y }
    goHome()
    untilTurn(world, tobin.id)
    Object.assign(scout, back)
    untilTurn(world, tobin.id)
    goHome()
    untilTurn(world, tobin.id)
    expect(outOfSight(world, 2)).toContain(storage.id)
    // Back in sight before his next turn: it is in sight, not last seen.
    Object.assign(scout, back)
    world.tick++
    stepLastSeen(world, terrain.size)
    expect(lastSeenTurn(world, tobin.id)).toBe(false)
    expect(outOfSight(world, 2)).not.toContain(storage.id)
    expect(
      lastSeenInSight(world, terrain, tobin.id, lastSeenOutOfSight(world, terrain.size, 2)),
    ).toEqual([])
  })

  it('refreshes a fresh realm at once, one with nobody looking every tick, and on connecting', () => {
    const { world, mara, tobin } = twoRealms()
    while (lastSeenTurn(world, mara.id) || lastSeenTurn(world, tobin.id)) world.tick++
    // Never refreshed since the start: both refresh off their turn.
    expect(stepLastSeen(world, terrain.size)).toBe(2)
    expect(lastSeenRefreshedAt(world, mara.id)).toBe(world.tick)
    // Off their turn nobody refreshes, until a Player connects.
    world.tick++
    while (lastSeenTurn(world, mara.id) || lastSeenTurn(world, tobin.id)) world.tick++
    expect(stepLastSeen(world, terrain.size)).toBe(0)
    refreshLastSeenSoon(world, mara.id)
    world.tick++
    while (lastSeenTurn(world, mara.id) || lastSeenTurn(world, tobin.id)) world.tick++
    expect(stepLastSeen(world, terrain.size)).toBe(1)
    expect(lastSeenRefreshedAt(world, mara.id)).toBe(world.tick)
    // Mara has nobody left to see through: she refreshes every tick until she has again.
    const hers = world.residents.filter((r) => r.owner === mara.id)
    world.residents = world.residents.filter((r) => r.owner !== mara.id)
    world.tick++
    stepLastSeen(world, terrain.size)
    for (let i = 0; i < 3; i++) {
      world.tick++
      stepLastSeen(world, terrain.size)
      expect(lastSeenRefreshedAt(world, mara.id)).toBe(world.tick)
    }
    world.residents.push(...hers)
    world.tick++
    stepLastSeen(world, terrain.size)
    expect(lastSeenRefreshedAt(world, mara.id)).toBe(world.tick)
    expect(world.lastSeen[1]!.some((e) => e.seenAt === world.tick)).toBe(true)
  })

  it('costs about one refresh in `LAST_SEEN_EVERY_TICKS` per realm', () => {
    const { world } = twoRealms()
    stepLastSeen(world, terrain.size)
    let refreshes = 0
    for (let i = 0; i < 4 * LAST_SEEN_EVERY_TICKS; i++) {
      world.tick++
      refreshes += stepLastSeen(world, terrain.size)
    }
    expect(refreshes).toBe(4 * world.realms.length)
  })

  it('flags, as an invariant, a realm off its cadence or remembering past its last refresh', () => {
    const { world, mara, tobin } = twoRealms()
    for (let i = 0; i < 3 * LAST_SEEN_EVERY_TICKS; i++) {
      world.tick++
      stepLastSeen(world, terrain.size)
      for (const realm of [mara, tobin]) expect(lastSeenOnCadence(world, realm.id)).toEqual([])
    }
    // Its refreshes stop.
    world.tick += LAST_SEEN_EVERY_TICKS
    expect(lastSeenOnCadence(world, tobin.id).map((v) => v.entityIds)).toEqual([[tobin.id]])
    // Something is remembered as of after its last refresh.
    untilTurn(world, tobin.id)
    const e = world.lastSeen[2]![0]!
    e.seenAt = world.tick + 1
    expect(lastSeenOnCadence(world, tobin.id).map((v) => v.entityIds)).toEqual([[e.id, tobin.id]])
  })
})
