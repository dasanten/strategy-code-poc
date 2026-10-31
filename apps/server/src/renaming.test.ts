import { parse, run } from '@csp/lang'
import {
  CITY_NAME_MAX_LENGTH,
  HORSE_NAME_MAX_LENGTH,
  REALM_NAME_MAX_LENGTH,
  RESIDENT_NAME_MAX_LENGTH,
  SCRIPT_API,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  canWork,
  realmName,
  type OrderRequest,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { recordEvent } from './events.js'
import { OrderQueue } from './orders.js'
import { cityNamesWellFormed, horseNamesWellFormed, residentNamesWellFormed } from './renaming.js'
import { lastSeenOutOfSight, refreshLastSeen } from './last-seen.js'
import { bindScript } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld } from './world.js'

const player = (userId: number) => ({ userId, account: { name: `p${userId}`, isAdmin: false } })
const mara = player(1)
const tobin = player(2)

/** Mara's and Tobin's starting cities; `miner` is a grown resident of Mara's, not her Leader. */
function setup() {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  foundStartingCity(world, terrain, mara.userId)
  foundStartingCity(world, terrain, tobin.userId)
  const realmOf = (p: { userId: number }) => world.realms.find((r) => r.userId === p.userId)!
  const realm = realmOf(mara)
  const byId = (id: string) => world.residents.find((r) => r.id === id)!
  const leader = byId(realm.leaderId)
  const miner = world.residents.find(
    (r) => r.owner === realm.id && r.id !== leader.id && canWork(r, world.tick),
  )!
  const stranger = byId(realmOf(tobin).leaderId)
  const queue = new OrderQueue(undefined, terrain)
  /** Sends an order and applies it as the next tick would; returns the answer. */
  const order = (o: object, sender = mara) => {
    const answer = queue.receive(world, sender, 'q', o)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  /** Renames `targetId` by hand, as the selection card does. */
  const rename = (targetId: string, name: unknown, more: object = {}, sender = mara) =>
    order({ kind: 'rename', residentId: targetId, targetId, name, ...more }, sender)
  return { world, terrain, realm, leader, miner, stranger, order, rename }
}

describe('Renaming a resident', () => {
  it('gives one of your own residents the new name, trimmed, from anywhere', () => {
    const { world, terrain, realm, miner, rename } = setup()
    // Far from home makes no difference.
    Object.assign(miner, { x: miner.x + 40, y: miner.y + 40 })
    expect(rename(miner.id, '  Old Gerd  ')).toBe('ok')
    expect(miner.name).toBe('Old Gerd')
    expect(realm.name).toBeUndefined()
    expect(residentNamesWellFormed.check(world, terrain)).toEqual([])
  })

  it('lets names repeat', () => {
    const { leader, miner, rename } = setup()
    expect(rename(miner.id, leader.name)).toBe('ok')
    expect(miner.name).toBe(leader.name)
  })

  it('leaves what the resident was doing, and their script, as it was', () => {
    const { miner, rename } = setup()
    const order = { kind: 'walkTo' as const, target: { x: 1, y: 1 }, path: null, progress: 0 }
    miner.order = order
    miner.script = { scriptId: 1, memory: {} } as never
    expect(rename(miner.id, 'Gerd')).toBe('ok')
    expect(miner.order).toBe(order)
    expect(miner.script).toBeDefined()
  })

  it('refuses residents of other realms', () => {
    const { stranger, miner, rename, order } = setup()
    const before = stranger.name
    expect(rename(stranger.id, 'Mine now')).toBe('not one of your residents')
    // Nor through one of your own asking.
    expect(order({ kind: 'rename', residentId: miner.id, targetId: stranger.id, name: 'X' })).toBe(
      'not one of your residents',
    )
    expect(stranger.name).toBe(before)
  })

  it('refuses bad names', () => {
    const { miner, rename } = setup()
    const before = miner.name
    expect(rename(miner.id, '')).toBe('Name: needs a name')
    expect(rename(miner.id, '   ')).toBe('Name: needs a name')
    expect(rename(miner.id, 7)).toBe('Name: needs a name')
    expect(rename(miner.id, 'x'.repeat(RESIDENT_NAME_MAX_LENGTH + 1))).toBe(
      `Name: at most ${RESIDENT_NAME_MAX_LENGTH} characters`,
    )
    expect(rename(miner.id, 'x'.repeat(RESIDENT_NAME_MAX_LENGTH))).toBe('ok')
    expect(miner.name).not.toBe(before)
  })

  it('keeps the old name in realm log entries from before', () => {
    const { world, realm, miner, rename } = setup()
    const before = miner.name
    recordEvent(world, realm.id, {
      kind: 'died',
      residentId: miner.id,
      name: miner.name,
      cause: 'starved',
      leader: false,
    })
    const logged = JSON.stringify(world.events)
    expect(rename(miner.id, 'Gerd')).toBe('ok')
    expect(JSON.stringify(world.events)).toBe(logged)
    expect(logged).toContain(before)
  })
})

describe('Renaming the Leader', () => {
  it('of a realm with no name yet needs a realm name, and names the realm with it', () => {
    const { realm, leader, rename } = setup()
    const before = leader.name
    expect(realm.name).toBeUndefined()
    expect(rename(leader.id, 'Queen Mara')).toMatch(/^Realm name: needs a name/)
    expect(rename(leader.id, 'Queen Mara', { realmName: '  ' })).toMatch(/^Realm name: needs/)
    const long = 'x'.repeat(REALM_NAME_MAX_LENGTH + 1)
    expect(rename(leader.id, 'Queen Mara', { realmName: long })).toMatch(
      `Realm name: at most ${REALM_NAME_MAX_LENGTH} characters`,
    )
    expect(leader.name).toBe(before)
    expect(realm.name).toBeUndefined()

    expect(rename(leader.id, 'Queen Mara', { realmName: ' Ironvale ' })).toBe('ok')
    expect(leader.name).toBe('Queen Mara')
    expect(realm.name).toBe('Ironvale')
  })

  it('of a named realm never renames the realm', () => {
    const { world, realm, leader, rename } = setup()
    realm.name = 'Ironvale'
    expect(rename(leader.id, 'Queen Mara')).toBe('ok')
    expect(leader.name).toBe('Queen Mara')
    expect(realmName(world, realm.id)).toBe('Ironvale')
    expect(rename(leader.id, 'Mara', { realmName: 'Elsewhere' })).toBe(
      'your realm has its name already',
    )
    expect(realm.name).toBe('Ironvale')
  })

  it('a realm name comes only with renaming the Leader', () => {
    const { realm, miner, rename } = setup()
    expect(rename(miner.id, 'Gerd', { realmName: 'Ironvale' })).toBe(
      'only renaming your Leader names your realm',
    )
    expect(realm.name).toBeUndefined()
  })
})

describe('Renaming from a script', () => {
  it('is in the script API and does what the order does', () => {
    expect(SCRIPT_API.some((b) => b.name === 'rename' && b.is === 'action')).toBe(true)
    const { world, terrain, realm, leader, miner, stranger } = setup()
    const run1 = (source: string, residentId: string) => {
      const memory = {}
      const { globals, requests } = bindScript({
        world,
        terrain,
        sender: mara,
        residentId,
        memory,
        seen: () => entitiesInSight(world, terrain, realm.id),
        explored: () => true,
      })
      run(parse(source), {
        globals,
        steps: 10_000,
        maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
        limits: SCRIPT_VALUE_LIMITS,
      })
      return { memory: memory as { answer?: unknown }, requests }
    }
    const apply = (requests: OrderRequest[]) => {
      const queue = new OrderQueue(undefined, terrain)
      for (const r of requests) expect(queue.receive(world, mara, 'q', r).type).toBe('ack')
      queue.applyAll(world)
    }

    // Any resident's script can rename another resident of the realm.
    const own = run1(`memory.answer = rename("${miner.id}", "Gerd")`, leader.id)
    expect(own.memory.answer).toBeNull()
    expect(own.requests).toEqual([
      { kind: 'rename', residentId: leader.id, targetId: miner.id, name: 'Gerd' },
    ])
    apply(own.requests)
    expect(miner.name).toBe('Gerd')

    const theirs = run1(`memory.answer = rename("${stranger.id}", "Mine")`, miner.id)
    expect(theirs.memory.answer).toBe('not one of your residents')
    expect(theirs.requests).toEqual([])
    expect(run1(`memory.answer = rename("${miner.id}", "")`, miner.id).memory.answer).toBe(
      'Name: needs a name',
    )

    // The Leader of an unnamed realm needs a realm name, from a script too.
    expect(run1(`memory.answer = rename(me.id, "Queen")`, leader.id).memory.answer).toMatch(
      /^Realm name/,
    )
    const naming = run1(`memory.answer = rename(me.id, "Queen", "Ironvale")`, leader.id)
    expect(naming.memory.answer).toBeNull()
    apply(naming.requests)
    expect(leader.name).toBe('Queen')
    expect(realm.name).toBe('Ironvale')
  })
})

describe('Renaming a horse', () => {
  type Setup = ReturnType<typeof setup>
  /** Renames `horseId` by hand, as the tile card does: asked by the Leader. */
  const renameHorse = (s: Setup, horseId: string, name: unknown, sender = mara) =>
    s.order({ kind: 'renameHorse', residentId: s.leader.id, horseId, name }, sender)
  const ownHorses = (s: Setup) => s.world.horses.filter((h) => h.realmId === s.realm.id)

  it('gives a horse of your realm the new name, trimmed, from anywhere', () => {
    const s = setup()
    const horse = ownHorses(s)[0]!
    // Every horse has a name from the start (`CONTEXT.md`: Horse name).
    expect(horse.name).toMatch(/\S/)
    // Far from home makes no difference: the Leader asks from wherever they stand.
    Object.assign(s.leader, { x: s.leader.x + 40, y: s.leader.y + 40 })
    expect(renameHorse(s, horse.id, '  Old Grey  ')).toBe('ok')
    expect(horse.name).toBe('Old Grey')
    expect(horseNamesWellFormed.check(s.world, s.terrain)).toEqual([])
  })

  it('lets names repeat', () => {
    const s = setup()
    const [a, b] = ownHorses(s)
    expect(renameHorse(s, a!.id, 'Twin')).toBe('ok')
    expect(renameHorse(s, b!.id, 'Twin')).toBe('ok')
    expect([a!.name, b!.name]).toEqual(['Twin', 'Twin'])
  })

  it('refuses other realms’ horses, NPC cities’ horses and bad names', () => {
    const s = setup()
    const horse = ownHorses(s)[0]!
    const was = horse.name
    const theirs = s.world.horses.find((h) => h.realmId === s.stranger.owner)!
    expect(renameHorse(s, theirs.id, 'Mine')).toBe('not one of your horses')
    s.world.horses.push({ ...horse, id: 'npc-horse', realmId: null, cityId: 'npc' })
    expect(renameHorse(s, 'npc-horse', 'Mine')).toBe('not one of your horses')
    expect(renameHorse(s, 'no-such-horse', 'Mine')).toBe('not one of your horses')
    // Tobin can't rename Mara's horse, not even asking through his own Leader.
    const order = {
      kind: 'renameHorse',
      residentId: s.stranger.id,
      horseId: horse.id,
      name: 'Mine',
    }
    expect(s.order(order, tobin)).toBe('not one of your horses')
    expect(renameHorse(s, horse.id, '')).toBe('Name: needs a name')
    expect(renameHorse(s, horse.id, '   ')).toBe('Name: needs a name')
    expect(renameHorse(s, horse.id, 7)).toBe('Name: needs a name')
    expect(renameHorse(s, horse.id, 'x'.repeat(HORSE_NAME_MAX_LENGTH + 1))).toBe(
      `Name: at most ${HORSE_NAME_MAX_LENGTH} characters`,
    )
    expect(horse.name).toBe(was)
  })

  it('keeps the old name in realm log entries from before', () => {
    const s = setup()
    const horse = ownHorses(s)[0]!
    const was = horse.name
    recordEvent(s.world, s.realm.id, {
      kind: 'foaled',
      horseId: horse.id,
      stableId: 's',
      name: was,
    })
    expect(renameHorse(s, horse.id, 'Grey')).toBe('ok')
    expect(s.world.events.at(-1)).toMatchObject({ kind: 'foaled', name: was })
  })
})

describe('Renaming a horse from a script', () => {
  it('is in the script API, does what the order does, and scripts see the name', () => {
    expect(SCRIPT_API.some((b) => b.name === 'renameHorse' && b.is === 'action')).toBe(true)
    const { world, terrain, realm, miner, stranger } = setup()
    const horse = world.horses.find((h) => h.realmId === realm.id)!
    const theirs = world.horses.find((h) => h.realmId === stranger.owner)!
    const run1 = (source: string, residentId: string) => {
      const memory = {}
      const { globals, requests } = bindScript({
        world,
        terrain,
        sender: mara,
        residentId,
        memory,
        seen: () => entitiesInSight(world, terrain, realm.id),
        explored: () => true,
      })
      run(parse(source), {
        globals,
        steps: 10_000,
        maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
        limits: SCRIPT_VALUE_LIMITS,
      })
      return { memory: memory as { answer?: unknown }, requests }
    }
    const apply = (requests: OrderRequest[]) => {
      const queue = new OrderQueue(undefined, terrain)
      for (const r of requests) expect(queue.receive(world, mara, 'q', r).type).toBe('ack')
      queue.applyAll(world)
    }

    const own = run1(`memory.answer = renameHorse("${horse.id}", "Grey")`, miner.id)
    expect(own.memory.answer).toBeNull()
    expect(own.requests).toEqual([
      { kind: 'renameHorse', residentId: miner.id, horseId: horse.id, name: 'Grey' },
    ])
    apply(own.requests)
    expect(horse.name).toBe('Grey')
    // The horse script view carries the name (`CONTEXT.md`: Horse name).
    const seen = run1('memory.answer = horses()', miner.id).memory.answer as {
      id: string
      name: string
    }[]
    expect(seen.find((h) => h.id === horse.id)?.name).toBe('Grey')

    const refused = run1(`memory.answer = renameHorse("${theirs.id}", "Mine")`, miner.id)
    expect(refused.memory.answer).toBe('not one of your horses')
    expect(refused.requests).toEqual([])
    expect(run1(`memory.answer = renameHorse("${horse.id}", "")`, miner.id).memory.answer).toBe(
      'Name: needs a name',
    )
  })
})

describe('horse-names-well-formed invariant', () => {
  it('reports an empty, untrimmed or too long name', () => {
    const { world, terrain, realm } = setup()
    expect(horseNamesWellFormed.check(world, terrain)).toEqual([])
    const [a, b] = world.horses.filter((h) => h.realmId === realm.id)
    a!.name = ' Grey'
    b!.name = 'x'.repeat(HORSE_NAME_MAX_LENGTH + 1)
    expect(horseNamesWellFormed.check(world, terrain).map((v) => v.entityIds)).toEqual([
      [a!.id],
      [b!.id],
    ])
  })
})

describe('resident-names-well-formed invariant', () => {
  it('reports an empty, untrimmed or too long name', () => {
    const { world, terrain, leader, miner } = setup()
    expect(residentNamesWellFormed.check(world, terrain)).toEqual([])
    miner.name = ' Gerd'
    leader.name = 'x'.repeat(RESIDENT_NAME_MAX_LENGTH + 1)
    expect(residentNamesWellFormed.check(world, terrain).map((v) => v.entityIds)).toEqual([
      [leader.id],
      [miner.id],
    ])
  })
})

describe('Renaming a city', () => {
  /** Mara's starting city and Tobin's; `renameCity` renames by hand, from Mara's Leader. */
  function citySetup() {
    const s = setup()
    const city = s.world.cities.find((c) => c.realmId === s.realm.id)!
    const theirs = s.world.cities.find((c) => c.realmId === s.stranger.owner)!
    const renameCity = (cityId: string, name: unknown, sender = mara, residentId = s.leader.id) =>
      s.order({ kind: 'renameCity', residentId, cityId, name }, sender)
    return { ...s, city, theirs, renameCity }
  }

  it('gives a city of your realm the new name, trimmed, from anywhere', () => {
    const { world, terrain, leader, city, renameCity } = citySetup()
    Object.assign(leader, { x: leader.x + 60, y: leader.y + 60 })
    expect(renameCity(city.id, '  Ironhold ')).toBe('ok')
    expect(city.name).toBe('Ironhold')
    expect(cityNamesWellFormed.check(world, terrain)).toEqual([])
  })

  it('lets city names repeat', () => {
    const { city, theirs, renameCity } = citySetup()
    expect(renameCity(city.id, theirs.name)).toBe('ok')
    expect(city.name).toBe(theirs.name)
  })

  it('refuses other realms’ cities and NPC cities', () => {
    const { world, city, theirs, renameCity, stranger } = citySetup()
    const before = theirs.name
    expect(renameCity(theirs.id, 'Mine now')).toBe('not one of your cities')
    expect(theirs.name).toBe(before)
    // An NPC city keeps its name, also when a Player's resident is the one asking.
    city.realmId = null
    expect(renameCity(city.id, 'Mine now')).toBe('not one of your cities')
    // Nor through a resident of someone else's.
    city.realmId = stranger.owner
    expect(renameCity(city.id, 'X', mara, stranger.id)).toBe('not one of your residents')
    expect(world.cities.every((c) => c.name !== 'Mine now' && c.name !== 'X')).toBe(true)
  })

  it('refuses bad names', () => {
    const { city, renameCity } = citySetup()
    const before = city.name
    expect(renameCity(city.id, '')).toBe('Name: needs a name')
    expect(renameCity(city.id, '  ')).toBe('Name: needs a name')
    expect(renameCity(city.id, 7)).toBe('Name: needs a name')
    expect(renameCity(city.id, 'x'.repeat(CITY_NAME_MAX_LENGTH + 1))).toBe(
      `Name: at most ${CITY_NAME_MAX_LENGTH} characters`,
    )
    expect(city.name).toBe(before)
    expect(renameCity(city.id, 'x'.repeat(CITY_NAME_MAX_LENGTH))).toBe('ok')
  })

  it('keeps its name when it changes hands, until its new owner renames it', () => {
    const { city, stranger, renameCity } = citySetup()
    const before = city.name
    city.realmId = stranger.owner
    expect(city.name).toBe(before)
    expect(renameCity(city.id, 'Ironhold')).toBe('not one of your cities')
    expect(renameCity(city.id, 'Tobinsby', tobin, stranger.id)).toBe('ok')
    expect(city.name).toBe('Tobinsby')
  })

  it('keeps the old name in realm log entries from before', () => {
    const { world, city, renameCity } = citySetup()
    const before = city.name
    const logged = JSON.stringify(world.events)
    expect(
      world.events.some((e) => e.userId === mara.userId && 'city' in e && e.city === before),
    ).toBe(true)
    expect(renameCity(city.id, 'Ironhold')).toBe('ok')
    expect(JSON.stringify(world.events)).toBe(logged)
  })

  it('is learnt by others only by sight: their Last seen keeps the old name', () => {
    const { world, terrain, city, stranger, renameCity } = citySetup()
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    const tobins = world.residents.filter((r) => r.owner === stranger.owner)
    const homes = tobins.map((r) => ({ x: r.x, y: r.y }))
    const step = () => {
      world.tick++
      refreshLastSeen(world, terrain.size)
    }
    const remembered = () =>
      lastSeenOutOfSight(world, terrain.size, tobin.userId).find((e) => e.id === city.id) as
        { name: string } | undefined
    const before = city.name
    // Tobin's people stand at Mara's town hall, then go home.
    for (const r of tobins) Object.assign(r, { x: hall.x, y: hall.y + 3 })
    step()
    tobins.forEach((r, i) => Object.assign(r, homes[i]))
    step()
    expect(remembered()?.name).toBe(before)

    expect(renameCity(city.id, 'Ironhold')).toBe('ok')
    step()
    step()
    expect(remembered()?.name).toBe(before)
    // What Tobin is sent of it keeps the old name too.
    const seen = entitiesInSight(world, terrain, stranger.owner!)
    expect(seen.some((e) => e.id === city.id)).toBe(false)

    // Back in sight: Tobin sees the new name, and no longer remembers the old one.
    for (const r of tobins) Object.assign(r, { x: hall.x, y: hall.y + 3 })
    step()
    expect(remembered()).toBeUndefined()
    expect(
      entitiesInSight(world, terrain, stranger.owner!).find((e) => e.id === city.id),
    ).toMatchObject({
      name: 'Ironhold',
    })
    tobins.forEach((r, i) => Object.assign(r, homes[i]))
    step()
    expect(remembered()?.name).toBe('Ironhold')
  })
})

describe('Renaming a city from a script', () => {
  it('is in the script API and does what the order does', () => {
    expect(SCRIPT_API.some((b) => b.name === 'renameCity' && b.is === 'action')).toBe(true)
    const { world, terrain, realm, miner, stranger } = setup()
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const theirs = world.cities.find((c) => c.realmId === stranger.owner)!
    const memory: { answer?: unknown } = {}
    const script = (source: string) => {
      const { globals, requests } = bindScript({
        world,
        terrain,
        sender: mara,
        residentId: miner.id,
        memory,
        seen: () => entitiesInSight(world, terrain, realm.id),
        explored: () => true,
      })
      run(parse(source), {
        globals,
        steps: 10_000,
        maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
        limits: SCRIPT_VALUE_LIMITS,
      })
      return requests
    }
    const requests = script(`memory.answer = renameCity("${city.id}", "Ironhold")`)
    expect(memory.answer).toBeNull()
    expect(requests).toEqual([
      { kind: 'renameCity', residentId: miner.id, cityId: city.id, name: 'Ironhold' },
    ])
    const queue = new OrderQueue(undefined, terrain)
    expect(queue.receive(world, mara, 'q', requests[0]).type).toBe('ack')
    queue.applyAll(world)
    expect(city.name).toBe('Ironhold')

    expect(script(`memory.answer = renameCity("${theirs.id}", "Mine")`)).toEqual([])
    expect(memory.answer).toBe('not one of your cities')
    script(`memory.answer = renameCity("${city.id}", "")`)
    expect(memory.answer).toBe('Name: needs a name')
  })
})

describe('city-names-well-formed invariant', () => {
  it('reports an empty, untrimmed or too long name', () => {
    const { world, terrain, realm, stranger } = setup()
    expect(cityNamesWellFormed.check(world, terrain)).toEqual([])
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const theirs = world.cities.find((c) => c.realmId === stranger.owner)!
    city.name = 'Ironhold '
    theirs.name = ''
    expect(cityNamesWellFormed.check(world, terrain).map((v) => v.entityIds)).toEqual([
      [city.id],
      [theirs.id],
    ])
  })
})
