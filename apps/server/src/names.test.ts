import {
  CARRYING_TICKS,
  NPC_VILLAGE,
  PAIRING_WAIT_TICKS,
  TICKS_PER_GAME_DAY,
  Terrain,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { joinRealm } from './capture.js'
import { CITY_NAMES, foundCity } from './cities.js'
import { checkInvariants } from './invariants.js'
import {
  baseName,
  cityGameNamesUnique,
  gameNamesUnique,
  numeral,
  residentNamesTaken,
  uniqueName,
} from './names.js'
import { foundNpcCity } from './npc-cities.js'
import { OrderQueue } from './orders.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { RESIDENT_NAMES, mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { addCity, cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld } from './world.js'

const me = { userId: 1, account: { name: 'Mara', isAdmin: false } }

/** Sends an order from Player 1 and applies it as the next tick would; returns the answer. */
function order(world: WorldState, o: object) {
  const queue = new OrderQueue()
  const answer = queue.receive(world, me, 'q', o)
  queue.applyAll(world)
  return answer
}

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

const names = (residents: Resident[]) => residents.map((r) => r.name)

describe('uniqueName', () => {
  it('keeps a free name, else takes the next free one of the list, else adds a numeral', () => {
    const pool = ['Edda', 'Bram', 'Wren']
    expect(uniqueName('Bram', new Set(['Edda']), pool)).toBe('Bram')
    expect(uniqueName('Bram', new Set(['Bram']), pool)).toBe('Wren')
    expect(uniqueName('Wren', new Set(['Wren', 'Edda']), pool)).toBe('Bram')
    expect(uniqueName('Edda', new Set(pool), pool)).toBe('Edda II')
    expect(uniqueName('Edda', new Set([...pool, 'Edda II', 'Edda III']), pool)).toBe('Edda IV')
    // Without a list, as for a resident joining a realm: straight to the numeral.
    expect(uniqueName('Edda II', new Set(['Edda II']))).toBe('Edda III')
  })

  it('writes numerals the Roman way', () => {
    expect([2, 3, 4, 9, 14, 40, 1999].map(numeral)).toEqual([
      'II',
      'III',
      'IV',
      'IX',
      'XIV',
      'XL',
      'MCMXCIX',
    ])
    expect(baseName('Edda XIV')).toBe('Edda')
    expect(baseName('Ivo')).toBe('Ivo')
  })
})

describe('Game-given names (`CONTEXT.md`)', () => {
  it('gives a starting city’s residents names that all differ, none the Leader’s the Player gave', () => {
    const terrain = cityTerrain()
    const world = createWorld(terrain)
    foundStartingCity(world, terrain, 1)
    const realm = world.realms[0]!
    const first = world.residents.filter((r) => r.owner === realm.id)
    expect(new Set(names(first)).size).toBe(first.length)
    expect(first.every((r) => r.gameName)).toBe(true)

    foundStartingCity(world, terrain, 2, { realmName: 'Reviewers Rest', leaderName: ' Edda ' })
    const second = world.residents.filter((r) => r.owner === world.realms[1]!.id)
    expect(second[0]).toMatchObject({ name: 'Edda' })
    expect(second[0]!.gameName).toBeUndefined()
    expect(new Set(names(second)).size).toBe(second.length)
    // Its city's name is none another city has.
    expect(world.cities[1]!.name).not.toBe(world.cities[0]!.name)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('gives a child born where every name of the list is taken a numeral', () => {
    const { world, terrain } = worldWithCity()
    world.buildings.find((b) => b.kind === 'storage')!.stock = { food: 100_000 }
    const realm = world.realms[0]!
    const [a, b] = world.residents as [Resident, Resident]
    // The rest of the list goes to homeless residents of the realm, who count but need no house.
    for (const name of RESIDENT_NAMES.filter((n) => !names(world.residents).includes(n))) {
      const r = newResident(mulberry32(world.residents.length), {
        id: `h${world.residents.length}`,
        owner: realm.id,
        x: a.x,
        y: a.y,
        tick: world.tick,
      })
      world.residents.push({ ...r, name, gameName: true })
    }
    expect(residentNamesTaken(world, realm.id, null)).toEqual(new Set(RESIDENT_NAMES))

    order(world, { kind: 'pair', residentId: a.id, partnerId: b.id })
    const born: Resident[] = []
    for (let t = 0; t <= PAIRING_WAIT_TICKS + CARRYING_TICKS; t += TICKS_PER_GAME_DAY) {
      world.tick += TICKS_PER_GAME_DAY
      born.push(...resolveBirths(world, requestBirths(world)))
    }
    expect(born).toHaveLength(1)
    expect(born[0]!.name).toMatch(/^\S+ II$/)
    expect(RESIDENT_NAMES).toContain(baseName(born[0]!.name))
    expect(born[0]!.gameName).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('never gives two cities one name, adding numerals once the list runs dry', () => {
    const terrain = plains(384)
    const world = createWorld(terrain)
    const rand = mulberry32(7)
    for (let i = 0; i < CITY_NAMES.length + 2; i++) {
      foundNpcCity(world, terrain, NPC_VILLAGE, 8 + (i % 5) * 72, 8 + Math.floor(i / 5) * 72, rand)
    }
    const cityNames = world.cities.map((c) => c.name)
    expect(new Set(cityNames).size).toBe(cityNames.length)
    expect(cityNames.filter((n) => / II$/.test(n))).toHaveLength(2)
    expect(world.cities.every((c) => c.gameName)).toBe(true)
    // Each NPC city is a realm of its own: its residents' names differ.
    for (const c of world.cities) {
      const own = world.residents.filter((r) => r.cityId === c.id)
      expect(new Set(names(own)).size).toBe(own.length)
    }
    expect(gameNamesUnique.check(world, terrain)).toEqual([])
    expect(cityGameNamesUnique.check(world, terrain)).toEqual([])
  })

  it('names a city founded by a town hall apart from every other', () => {
    const { world } = worldWithCity()
    for (const name of CITY_NAMES)
      addCity(world, { id: `c-${name}`, realmId: null, x: 0, y: 0, name })
    const hall: Building = { id: 'hall', kind: 'townHall', cityId: null, x: 5, y: 5 }
    world.buildings.push(hall)
    const city = foundCity(world, hall, world.realms[0]!.id)
    expect(city.name).toMatch(/ II$/)
    expect(city.gameName).toBe(true)
  })

  it('adds a numeral to a resident who joins a realm with a name of the game it already has', () => {
    const { world, terrain } = worldWithCity()
    const realm = world.realms[0]!
    const edda = world.residents[1]!
    const city = addCity(world, { id: 'npc', realmId: null, x: 40, y: 40, name: 'Coldwater' })
    const join = (id: string, name: string, gameName: boolean): Resident => {
      const r = newResident(mulberry32(id.length), {
        id,
        owner: null,
        cityId: city.id,
        x: 40,
        y: 41,
        tick: world.tick,
      })
      const joiner = { ...r, name, ...(gameName ? { gameName: true as const } : {}) }
      world.residents.push(joiner)
      return joiner
    }
    const twin = join('j1', edda.name, true)
    // A name the Player gave stays as it is, even when the realm has it too.
    const renamed = join('j2', edda.name, false)
    joinRealm(world, city, realm.id, terrain.size)
    expect(twin).toMatchObject({ owner: realm.id, name: `${edda.name} II`, gameName: true })
    expect(renamed).toMatchObject({ owner: realm.id, name: edda.name })
    expect(gameNamesUnique.check(world, terrain)).toEqual([])
  })

  it('stops counting a name as the game’s once the Player renames, so renames may repeat names', () => {
    const { world, terrain } = worldWithCity()
    const [leader, mara] = world.residents as [Resident, Resident]
    expect(
      order(world, { kind: 'rename', residentId: leader.id, targetId: mara.id, name: leader.name }),
    ).toMatchObject({ type: 'ack' })
    expect(mara.gameName).toBeUndefined()
    const city = world.cities[0]!
    world.cities.push({ ...city, id: 'other', gameName: true, name: 'Thornbury' })
    order(world, { kind: 'renameCity', residentId: leader.id, cityId: city.id, name: 'Thornbury' })
    expect(city.gameName).toBeUndefined()
    expect(gameNamesUnique.check(world, terrain)).toEqual([])
    expect(cityGameNamesUnique.check(world, terrain)).toEqual([])
  })
})

describe('Invariants: game-names-unique, city-game-names-unique', () => {
  it('report two living residents of one realm, or of one NPC city, with one name of the game', () => {
    const { world, terrain } = worldWithCity()
    const [a, b] = world.residents as [Resident, Resident]
    b.name = a.name
    expect(gameNamesUnique.check(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'game-names-unique', entityIds: [a.id, b.id] }),
    ])
    // Not once one of them is dead, or renamed.
    b.health = 0
    expect(gameNamesUnique.check(world, terrain)).toEqual([])
    b.health = 10
    delete b.gameName
    expect(gameNamesUnique.check(world, terrain)).toEqual([])

    // Residents of no realm share one with those of the NPC city they live in only.
    const npc = (id: string, cityId: string | null): Resident => ({
      ...newResident(mulberry32(1), { id, owner: null, cityId, x: 1, y: 1, tick: 0 }),
      name: 'Ivo',
      gameName: true,
    })
    world.residents.push(npc('n1', 'c1'), npc('n2', 'c2'), npc('n3', null), npc('n4', null))
    expect(gameNamesUnique.check(world, terrain)).toEqual([])
    world.residents.push(npc('n5', 'c1'))
    expect(gameNamesUnique.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['n1', 'n5'] }),
    ])
  })

  it('reports two cities with one name of the game, not one the Player gave', () => {
    const { world, terrain } = worldWithCity()
    const city = world.cities[0]!
    world.cities.push({ ...city, id: 'twin' })
    expect(cityGameNamesUnique.check(world, terrain)).toEqual([
      expect.objectContaining({
        invariant: 'city-game-names-unique',
        entityIds: [city.id, 'twin'],
      }),
    ])
    delete world.cities[1]!.gameName
    expect(cityGameNamesUnique.check(world, terrain)).toEqual([])
  })
})
