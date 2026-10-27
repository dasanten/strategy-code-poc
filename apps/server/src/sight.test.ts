import {
  CHUNK_SIZE,
  SIGHT_RANGE,
  START_HORSES,
  chunksAcross,
  townHallOf,
  ALLIANCE_LEAVE_DELAY,
  diplomacyFor,
  type Realm,
  wrapDistance,
  CARRIAGE_CAPACITY,
  CARRIAGE_LIGHT_LOAD,
  GOOD_WEIGHT,
  footprintTiles,
  loadLevel,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ExploredTerrain } from './explored.js'
import { stepAlliances } from './alliances.js'
import { SightTracker, entitiesInSight, sentInsideUnseen, sentOutOfSight } from './sight.js'
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

describe('shared sight', () => {
  /** Three Players far apart; Mara and Tobin are in an alliance, Wren is not. */
  function allied() {
    const world = createWorld(terrain)
    const [mara, tobin, wren] = [1, 2, 3].map((u) => foundStartingCity(world, terrain, u)) as [
      Realm,
      Realm,
      Realm,
    ]
    world.alliances.push({
      id: 'alliance-1',
      name: 'North',
      leaderId: mara.id,
      members: [mara, tobin].map((r) => ({ realmId: r.id, joinedAt: 0, leaving: null })),
      invites: [],
      army: [],
    })
    const ids = (realmId: string) =>
      new Set(entitiesInSight(world, terrain, realmId).map((e) => e.id))
    const residentsOf = (realm: Realm) => world.residents.filter((r) => r.owner === realm.id)
    return { world, mara, tobin, wren, ids, residentsOf }
  }

  it('lets members see what any member’s residents see, and nobody else', () => {
    const { world, mara, tobin, wren, ids, residentsOf } = allied()
    const tobinCity = world.cities.find((c) => c.realmId === tobin.id)!
    for (const viewer of [mara, tobin]) {
      const seen = ids(viewer.id)
      for (const r of [...residentsOf(mara), ...residentsOf(tobin)]) expect(seen).toContain(r.id)
      expect(seen).toContain(tobinCity.id)
      for (const r of residentsOf(wren)) expect(seen).not.toContain(r.id)
    }
    const wrenSees = ids(wren.id)
    for (const r of [...residentsOf(mara), ...residentsOf(tobin)])
      expect(wrenSees).not.toContain(r.id)
    // A stranger near Tobin's city is seen by Mara through Tobin's residents.
    const stranger = residentsOf(wren)[0]!
    const tobinHall = townHallOf(world, tobinCity)!
    Object.assign(stranger, { x: tobinHall.x, y: tobinHall.y })
    expect(ids(mara.id)).toContain(stranger.id)
    // ... but, as a member, not passed on as one who could be invited.
    const seenRealms = residentsOf(tobin)
      .concat(stranger)
      .map((r) => r.owner!)
    const diplomacy = diplomacyFor(world, mara.id, seenRealms)
    expect(diplomacy.realmsInSight.map((r) => r.realmId)).toEqual([wren.id])
  })

  it('ends shared sight with the leave delay, not before', () => {
    const { world, mara, tobin, ids, residentsOf } = allied()
    const member = world.alliances[0]!.members[1]!
    member.leaving = { at: world.tick + ALLIANCE_LEAVE_DELAY, removed: false }
    for (let i = 0; i < ALLIANCE_LEAVE_DELAY - 1; i++) {
      world.tick++
      stepAlliances(world)
    }
    expect(ids(mara.id)).toContain(residentsOf(tobin)[0]!.id)
    world.tick++
    stepAlliances(world)
    expect(world.alliances[0]?.members.map((m) => m.realmId)).toEqual([mara.id])
    expect(ids(mara.id)).not.toContain(residentsOf(tobin)[0]!.id)
    expect(ids(tobin.id)).not.toContain(residentsOf(mara)[0]!.id)
  })

  it('explores for every member around any member’s residents, a new member at once', () => {
    const { world, mara, tobin, wren, residentsOf } = allied()
    const explored = new ExploredTerrain(terrain)
    const sight = new SightTracker()
    sight.update(world, explored)
    const at = (realm: Realm) => residentsOf(realm)[0]!
    const user = (realm: Realm) => ({ id: realm.userId })
    expect(explored.isExplored(user(mara), at(tobin).x, at(tobin).y)).toBe(true)
    expect(explored.isExplored(user(tobin), at(mara).x, at(mara).y)).toBe(true)
    expect(explored.isExplored(user(mara), at(wren).x, at(wren).y)).toBe(false)
    // Wren joins: without anyone moving, they explore around Mara's and Tobin's residents, and
    // they around Wren's.
    world.alliances[0]!.members.push({ realmId: wren.id, joinedAt: world.tick, leaving: null })
    const grown = sight.update(world, explored)
    expect(grown.get(wren.userId)?.size).toBeGreaterThan(0)
    expect(explored.isExplored(user(wren), at(mara).x, at(mara).y)).toBe(true)
    expect(explored.isExplored(user(mara), at(wren).x, at(wren).y)).toBe(true)
    // Nobody moved since: nothing new.
    expect(sight.update(world, explored)).toEqual(new Map())
  })

  it('reports anything sent to a Player outside their own or their alliance’s sight', () => {
    const { world, mara, tobin, wren } = allied()
    for (const realm of [mara, tobin, wren]) {
      expect(
        sentOutOfSight(world, terrain, realm.id, entitiesInSight(world, terrain, realm.id)),
      ).toEqual([])
    }
    // What Tobin sees, sent to Wren, is all outside Wren's sight; the cities included.
    const tobins = entitiesInSight(world, terrain, tobin.id)
    const out = sentOutOfSight(world, terrain, wren.id, tobins)
    expect(out.map((v) => v.entityIds[0])).toEqual(tobins.map((e) => e.id))
    expect(out[0]?.invariant).toBe('sent-only-in-sight')
    // Once Tobin's residents leave the alliance, what they see is outside Mara's sight.
    world.alliances[0]!.members.pop()
    expect(sentOutOfSight(world, terrain, mara.id, tobins).length).toBeGreaterThan(0)
  })
})

describe('seeing inside (`CONTEXT.md`: Seeing inside a storage, Seeing how someone fares)', () => {
  /** Two Players far apart, and a scout of Tobin's standing in Mara's city near its storage. */
  function twoRealms() {
    const world = createWorld(terrain)
    foundStartingCity(world, terrain, 1)
    foundStartingCity(world, terrain, 2)
    const [mara, tobin] = world.realms as [Realm, Realm]
    const city = world.cities.find((c) => c.realmId === mara.id)!
    const storage = world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!
    const carriage = world.carriages.find((k) => k.realmId === mara.id)!
    Object.assign(carriage, { x: storage.x + 6, y: storage.y, load: { food: 40 } })
    const scout = world.residents.find((r) => r.owner === tobin.id)!
    Object.assign(scout, { x: storage.x + 3, y: storage.y + 3, order: null })
    const seenBy = (realm: Realm) => {
      const seen = entitiesInSight(world, terrain, realm.id)
      const find = (id: string) => seen.find((e) => e.id === id)
      return { seen, find }
    }
    return { world, mara, tobin, storage, carriage, scout, seenBy }
  }

  it('shows its own Organization what is inside and how its people fare', () => {
    const { world, mara, storage, carriage, seenBy } = twoRealms()
    const { seen, find } = seenBy(mara)
    expect(find(storage.id)).toHaveProperty('stock', storage.stock)
    expect(find(carriage.id)).toMatchObject({ load: { food: 40 }, loadLevel: 'light' })
    for (const e of seen.filter((e) => e.is === 'resident' || e.is === 'horse')) {
      if (e.is === 'resident' && e.owner !== mara.id) continue
      expect(e.hunger).toBeTypeOf('number')
      expect(e.health).toBeTypeOf('number')
    }
    expect(sentInsideUnseen(world, terrain, mara.id, seen)).toEqual([])
  })

  it('shows a stranger in sight only the building, how heavily a carriage is loaded, and no one’s hunger or health', () => {
    const { world, mara, tobin, storage, carriage, seenBy } = twoRealms()
    const { seen, find } = seenBy(tobin)
    expect(find(storage.id)).toBeDefined()
    expect(find(storage.id)).not.toHaveProperty('stock')
    expect(find(carriage.id)).toMatchObject({ loadLevel: 'light' })
    expect(find(carriage.id)).not.toHaveProperty('load')
    const theirs = seen.filter(
      (e) =>
        (e.is === 'resident' && e.owner === mara.id) || (e.is === 'horse' && e.realmId === mara.id),
    )
    expect(theirs.length).toBeGreaterThan(0)
    for (const e of theirs) {
      expect(e).not.toHaveProperty('hunger')
      expect(e).not.toHaveProperty('health')
    }
    expect(sentInsideUnseen(world, terrain, tobin.id, seen)).toEqual([])
  })

  it('shows a stranger with a resident at the storage, or on the carriage’s tile, what is inside', () => {
    const { mara, tobin, storage, carriage, scout, seenBy } = twoRealms()
    // On the far tile of the storage's footprint: any tile of it counts (`CONTEXT.md`: At a building).
    const [fx, fy] = footprintTiles(storage, terrain.size).at(-1)!
    Object.assign(scout, { x: fx, y: fy })
    let seen = seenBy(tobin)
    expect(seen.find(storage.id)).toHaveProperty('stock', storage.stock)
    expect(seen.find(carriage.id)).not.toHaveProperty('load')
    Object.assign(scout, { x: carriage.x, y: carriage.y })
    seen = seenBy(tobin)
    expect(seen.find(carriage.id)).toHaveProperty('load', { food: 40 })
    expect(seen.find(storage.id)).not.toHaveProperty('stock')
    // Standing there tells nothing of how Mara's people fare.
    const theirs = seen.seen.filter((e) => e.is === 'resident' && e.owner === mara.id)
    for (const e of theirs) expect(e).not.toHaveProperty('hunger')
  })

  it('shows an ally what is inside and how their people fare', () => {
    const { world, mara, tobin, storage, carriage, seenBy } = twoRealms()
    world.alliances.push({
      id: 'alliance-1',
      name: 'North',
      leaderId: mara.id,
      members: [mara, tobin].map((r) => ({ realmId: r.id, joinedAt: 0, leaving: null })),
      invites: [],
      army: [],
    })
    const { seen, find } = seenBy(tobin)
    expect(find(storage.id)).toHaveProperty('stock', storage.stock)
    expect(find(carriage.id)).toHaveProperty('load', { food: 40 })
    const theirs = seen.filter((e) => e.is === 'resident' && e.owner === mara.id)
    expect(theirs.length).toBeGreaterThan(0)
    for (const e of theirs) expect(e).toHaveProperty('hunger')
  })

  it('flags, as an invariant, anything inside sent to a stranger', () => {
    const { world, mara, tobin, storage, carriage, seenBy } = twoRealms()
    // What Mara sees, sent to Tobin by mistake: everything of hers he has in sight.
    const inHisSight = new Set(seenBy(tobin).seen.map((e) => e.id))
    const leaked = seenBy(mara).seen.filter((e) => inHisSight.has(e.id))
    const flagged = new Set(
      sentInsideUnseen(world, terrain, tobin.id, leaked).flatMap((v) => v.entityIds),
    )
    expect(flagged).toContain(storage.id)
    expect(flagged).toContain(carriage.id)
    const hers = world.residents.find((r) => r.owner === mara.id && inHisSight.has(r.id))!
    expect(flagged).toContain(hers.id)
  })
})

describe('loadLevel', () => {
  it('names how heavily a carriage is loaded by weight against its capacity', () => {
    const food = (kg: number) => ({ food: kg / GOOD_WEIGHT.food })
    const level = (kg: number) => loadLevel(food(kg), CARRIAGE_CAPACITY)
    expect(level(0)).toBe('empty')
    expect(level(CARRIAGE_CAPACITY * CARRIAGE_LIGHT_LOAD)).toBe('light')
    expect(level(CARRIAGE_CAPACITY / 2)).toBe('half')
    expect(level(CARRIAGE_CAPACITY * 0.9)).toBe('heavy')
    expect(level(CARRIAGE_CAPACITY)).toBe('full')
    // Behind a stronger horse the same load leaves room.
    expect(loadLevel(food(CARRIAGE_CAPACITY), CARRIAGE_CAPACITY * 1.2)).toBe('heavy')
  })
})
