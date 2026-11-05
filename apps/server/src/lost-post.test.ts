import {
  AVERAGE_HORSE_STATS,
  CRIME_MEMORY_DAYS,
  CRIME_STANDING_LOSS,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_LOSS,
  Terrain,
  crewIdsOf,
  standingOf,
  townHallOf,
  type City,
  type Crime,
  type Resident,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { stepCrimes } from './crimes.js'
import { crimesSound, checkInvariants } from './invariants.js'
import { mulberry32 } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { die } from './survival.js'
import { foundTradeOrgHq } from './trade-org.js'
import { stepDebts } from './trade-org-debt.js'
import { stepPunishments } from './trade-org-punishment.js'
import { placeTraders, stepTraders, tradersSound } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { migrateWorld } from './world-format.js'
import { createWorld, stepWorld } from './world.js'

const size = 512
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }

/** The Trade Org HQ, three trading posts with its traders, and a Player's realm, all well apart. */
function fixture() {
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 128, 128, rand)
  const posts = [
    foundTradingPost(world, terrain, 220, 128, undefined, rand),
    foundTradingPost(world, terrain, 220, 220, undefined, rand),
    foundTradingPost(world, terrain, 128, 220, undefined, rand),
  ]
  const traders = placeTraders(world, size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  const realm = foundStartingCity(world, terrain, 7)
  const leader = world.residents.find((r) => r.id === realm.leaderId)!
  return { world, hq, posts, traders, realm, leader }
}

const crewOf = (world: WorldState, t: Trader) =>
  crewIdsOf(t).map((id) => world.residents.find((r) => r.id === id)!)

const carriageOf = (world: WorldState, t: Trader) =>
  world.carriages.find((k) => k.id === t.carriageId)!

const hallOf = (world: WorldState, city: City) => townHallOf(world, city)!

/** Stands a trader on (x, y), armed, out to `post` with no stops to make on the way. */
function put(world: WorldState, t: Trader, post: City, x: number, y: number) {
  const carriage = carriageOf(world, t)
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  for (const thing of [carriage, horse, ...crewOf(world, t)]) {
    thing.x = x
    thing.y = y
  }
  for (const r of crewOf(world, t)) {
    r.order = null
    r.carried.spear = 1
  }
  t.heading = 'post'
  t.postId = post.id
  t.stop = 'storage'
  t.calls = []
  t.stand = null
}

/** `by`, armed, stands on the post's town hall as it falls to their realm. */
function capture(world: WorldState, post: City, by: Resident) {
  const hall = hallOf(world, post)
  by.x = hall.x
  by.y = hall.y
  by.carried.spear = 1
  by.order = null
  captureCity(world, post, by.owner!, size)
}

const captureOf = (world: WorldState, post: City): Crime | undefined =>
  world.crimes.find((c) => c.kind === 'capture' && c.post === post.id)

/** Arms everyone at the HQ, so it has soldiers to spare for a punishment. */
function armHq(world: WorldState, hq: City) {
  for (const r of world.residents) if (r.owner === null && r.cityId === hq.id) r.carried.spear = 1
}

/** How the Trade Organization regards `realmId`. */
const regard = (world: WorldState, realmId: string) => standingOf(world, TRADE_ORG, realmId)

function runUntil(world: WorldState, done: () => boolean, ticks: number) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && !done(); t++) stepWorld(world, terrain, walking)
  expect(done()).toBe(true)
}

describe('a captured trading post', () => {
  it('is a crime nobody knows of, and nothing reacts until the news comes', () => {
    const { world, posts, realm, leader, hq } = fixture()
    const post = posts[0]!
    capture(world, post, leader)
    expect(post.tradeOrg).toBeUndefined()
    expect(captureOf(world, post)).toMatchObject({
      culprit: { residentId: leader.id, org: realm.id },
      victimOrg: hq.id,
      witnesses: [],
      knownBy: [],
    })
    for (const t of world.traders) expect(t.loop).toContain(post.id)
    for (let i = 0; i < 40; i++) {
      stepCrimes(world, size)
      stepPunishments(world, size)
      world.tick += TICKS_PER_GAME_DAY
    }
    // Long past what a crime is remembered for, it still waits to be found out.
    expect(captureOf(world, post)).toMatchObject({ witnesses: [], knownBy: [] })
    expect(regard(world, realm.id)).toBe(0)
    expect(world.punishments).toEqual([])
    expect(crimesSound.check(world, terrain)).toEqual([])
  })

  it('has none of its own residents for witnesses: they joined the captor', () => {
    const { world, posts, realm, leader } = fixture()
    const post = posts[0]!
    const own = world.residents.filter((r) => r.cityId === post.id)
    expect(own.length).toBeGreaterThan(0)
    capture(world, post, leader)
    for (const r of own) expect(r.owner).toBe(realm.id)
    expect(captureOf(world, post)!.witnesses).toEqual([])
  })

  it('is no such crime for any other city', () => {
    const { world, hq, leader } = fixture()
    capture(world, hq, leader)
    expect(world.crimes.filter((c) => c.kind === 'capture')).toEqual([])
  })
})

describe('a wandering trader reaching a lost post', () => {
  it('drops it from its loop, goes on, and only the news it brings causes the reaction', () => {
    const { world, hq, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    armHq(world, hq)
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    const next = trader.loop[(trader.loop.indexOf(post.id) + 1) % trader.loop.length]
    stepTraders(world, size)
    expect(trader.loop).not.toContain(post.id)
    expect(trader.postId).toBe(next)
    const crime = captureOf(world, post)!
    expect(crime.witnesses.sort()).toEqual(crewIdsOf(trader).sort())
    // It knows; the Trade Organization doesn't yet.
    stepCrimes(world, size)
    expect(crime.knownBy).toEqual([])
    expect(regard(world, realm.id)).toBe(0)
    // At another post, the news is in.
    const other = hallOf(world, posts[1]!)
    put(world, trader, posts[1]!, other.x, other.y)
    stepCrimes(world, size)
    expect(crime.knownBy).toEqual([crime.victimOrg])
    expect(crime.witnesses).toEqual([])
    expect(regard(world, realm.id)).toBe(-CRIME_STANDING_LOSS.capture)
    // A debt for its worth, and no army of its own (`CONTEXT.md`: Trade Org debt).
    stepDebts(world)
    stepPunishments(world, size)
    expect(world.debts).toEqual([
      { org: realm.id, coins: TRADE_ORG_LOSS.capture, cityId: post.id },
    ])
    expect(world.punishments).toEqual([])
    expect(crime.punished).toBe(true)
    expect(crimesSound.check(world, terrain)).toEqual([])
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('tells the HQ just the same', () => {
    const { world, hq, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    stepTraders(world, size)
    const home = hallOf(world, hq)
    put(world, trader, posts[1]!, home.x, home.y)
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(-CRIME_STANDING_LOSS.capture)
  })

  it('remembers it from when the news came, however long the post stood lost', () => {
    const { world, hq, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    armHq(world, hq)
    capture(world, post, leader)
    world.tick += 5 * CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    stepTraders(world, size)
    const other = hallOf(world, posts[1]!)
    put(world, trader, posts[1]!, other.x, other.y)
    stepCrimes(world, size)
    expect(captureOf(world, post)).toMatchObject({ heardAt: world.tick })
    stepDebts(world)
    expect(world.debts).toHaveLength(1)
    expect(crimesSound.check(world, terrain)).toEqual([])
    world.tick += CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
    stepCrimes(world, size)
    expect(captureOf(world, post)).toBeUndefined()
    expect(regard(world, realm.id)).toBeLessThan(0)
  })

  it('drives up to it and finds out, running the whole world, and the news comes in by the next post', () => {
    const { world, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x - 40, hall.y)
    // It is a Player's city now, so its way there would stop at it too.
    trader.calls = [post.id]
    runUntil(world, () => !trader.loop.includes(post.id), 1500)
    expect(captureOf(world, post)!.witnesses.length).toBeGreaterThan(0)
    expect(trader.stand?.cityId).not.toBe(post.id)
    expect(trader.calls).not.toContain(post.id)
    expect(regard(world, realm.id)).toBe(0)
    runUntil(world, () => regard(world, realm.id) < 0, 6000)
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)

  it('finds out at closed gates too, without getting in', () => {
    const { world, posts, traders, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    for (const b of world.buildings) {
      if (b.cityId === post.id && b.kind === 'gate') b.closed = true
    }
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x - 40, hall.y)
    const crew = crewOf(world, trader)
    runUntil(world, () => !trader.loop.includes(post.id), 1500)
    expect(captureOf(world, post)!.witnesses.sort()).toEqual(crew.map((r) => r.id).sort())
  }, 120_000)

  it('gives up a stop there and leaves the city out of its calls, so the news goes straight on', () => {
    const { world, posts, traders, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    trader.stand = { cityId: post.id, x: hall.x - 20, y: hall.y, until: null }
    const driver = crewOf(world, trader)[0]!
    driver.order = {
      kind: 'drive',
      carriageId: trader.carriageId,
      target: { x: hall.x - 20, y: hall.y },
      path: null,
      progress: 0,
    }
    stepTraders(world, size)
    expect(trader.loop).not.toContain(post.id)
    expect(trader.stand).toBeNull()
    expect(trader.calls).not.toBeNull()
    expect(trader.calls).not.toContain(post.id)
    // Off to the next post at once, not to the stop.
    expect(driver.order).toMatchObject({ kind: 'drive' })
    expect(driver.order).not.toMatchObject({ target: { x: hall.x - 20, y: hall.y } })
  })

  it('goes on driving to a stop at another city', () => {
    const { world, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    const stand = { cityId: realm.id, x: hall.x - 20, y: hall.y, until: null }
    trader.stand = stand
    const driver = crewOf(world, trader)[0]!
    const drive = {
      kind: 'drive' as const,
      carriageId: trader.carriageId,
      target: { x: stand.x, y: stand.y },
      path: null,
      progress: 0,
    }
    driver.order = drive
    stepTraders(world, size)
    expect(trader.loop).not.toContain(post.id)
    expect(trader.stand).toEqual(stand)
    expect(driver.order).toEqual(drive)
  })

  it('with no crew by the carriage has seen nothing yet', () => {
    const { world, posts, traders, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    for (const r of crewOf(world, trader)) die(world, r)
    const stands = trader.loop.length
    stepTraders(world, size)
    expect(trader.loop).toHaveLength(stands)
    expect(captureOf(world, post)!.witnesses).toEqual([])
  })
})

describe('a trader killed on the way', () => {
  it('brings no news, and the next trader that gets there still can', () => {
    const { world, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const [first, second] = traders
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, first!, post, hall.x, hall.y)
    stepTraders(world, size)
    for (const r of crewOf(world, first!)) die(world, r)
    stepCrimes(world, size)
    expect(captureOf(world, post)).toMatchObject({ witnesses: [], knownBy: [] })
    expect(regard(world, realm.id)).toBe(0)
    expect(crimesSound.check(world, terrain)).toEqual([])
    // The others still have it on their loops.
    put(world, second!, post, hall.x, hall.y)
    stepTraders(world, size)
    const other = hallOf(world, posts[1]!)
    put(world, second!, posts[1]!, other.x, other.y)
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(-CRIME_STANDING_LOSS.capture)
  })

  it('and with no trader left to find out, it never reacts', () => {
    const { world, posts, traders, realm, leader } = fixture()
    const post = posts[0]!
    const trader = traders[0]!
    world.traders = [trader]
    capture(world, post, leader)
    const hall = hallOf(world, post)
    put(world, trader, post, hall.x, hall.y)
    stepTraders(world, size)
    for (const r of crewOf(world, trader)) die(world, r)
    stepCrimes(world, size)
    expect(captureOf(world, post)).toBeUndefined()
    expect(regard(world, realm.id)).toBe(0)
    expect(crimesSound.check(world, terrain)).toEqual([])
  })
})

describe('a witness of the capture', () => {
  /** One of the HQ's residents, in sight of the post's town hall. */
  function bystander(world: WorldState, hq: City, post: City): Resident {
    const r = world.residents.find((x) => x.cityId === hq.id && x.owner === null)!
    const hall = hallOf(world, post)
    r.x = hall.x + SIGHT_RANGE
    r.y = hall.y
    return r
  }

  it('who gets away brings the news to the HQ', () => {
    const { world, hq, posts, realm, leader } = fixture()
    const post = posts[0]!
    const witness = bystander(world, hq, post)
    capture(world, post, leader)
    expect(captureOf(world, post)!.witnesses).toContain(witness.id)
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(0)
    const home = hallOf(world, hq)
    witness.x = home.x
    witness.y = home.y
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(-CRIME_STANDING_LOSS.capture)
  })

  it('who gets to another post brings it there, one of that post’s own as well', () => {
    const { world, posts, realm, leader } = fixture()
    const [post, other] = posts
    const hall = hallOf(world, post!)
    const witness = world.residents.find((x) => x.cityId === other!.id)!
    witness.x = hall.x + 10
    witness.y = hall.y
    capture(world, post!, leader)
    expect(captureOf(world, post!)!.witnesses).toContain(witness.id)
    const there = hallOf(world, other!)
    witness.x = there.x
    witness.y = there.y
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(-CRIME_STANDING_LOSS.capture)
  })

  it('who is killed first brings nothing', () => {
    const { world, hq, posts, realm, leader } = fixture()
    const post = posts[0]!
    const witness = bystander(world, hq, post)
    capture(world, post, leader)
    die(world, witness)
    stepCrimes(world, size)
    expect(regard(world, realm.id)).toBe(0)
    expect(crimesSound.check(world, terrain)).toEqual([])
  })

  it('who joins the culprit with the fall of the HQ takes the news with them', () => {
    const { world, hq, posts, leader, realm } = fixture()
    const post = posts[0]!
    const witness = bystander(world, hq, post)
    capture(world, post, leader)
    expect(captureOf(world, post)!.witnesses).toContain(witness.id)
    capture(world, hq, leader)
    expect(witness.owner).toBe(realm.id)
    stepCrimes(world, size)
    expect(captureOf(world, post)).toBeUndefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('invariants of a lost post', () => {
  it('allow it on a loop, but not a city that is gone', () => {
    const { world, posts, traders, leader } = fixture()
    const post = posts[0]!
    capture(world, post, leader)
    expect(tradersSound.check(world, terrain)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
    world.cities = world.cities.filter((c) => c !== post)
    expect(tradersSound.check(world, terrain).map((v) => v.message)).toContain(
      `trader ${traders[0]!.id} has ${post.id} on its loop, which is no city`,
    )
    // And the trader lets go of it, which forgets a crime nobody can find out any more.
    stepTraders(world, size)
    stepCrimes(world, size)
    expect(traders[0]!.loop).not.toContain(post.id)
    expect(captureOf(world, post)).toBeUndefined()
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('catch a capture kept with no way left to hear of it, or naming no post', () => {
    const { world, posts, leader } = fixture()
    const post = posts[0]!
    capture(world, post, leader)
    const crime = captureOf(world, post)!
    expect(crimesSound.check(world, terrain)).toEqual([])
    for (const t of world.traders) t.loop = t.loop.filter((id) => id !== post.id)
    expect(crimesSound.check(world, terrain).map((v) => v.message)).toEqual([
      `crime ${crime.id} is kept though forgotten`,
    ])
    world.crimes = [{ ...crime, witnesses: [leader.id], post: undefined }]
    expect(crimesSound.check(world, terrain).map((v) => v.message)).toContain(
      `crime ${crime.id} names a post without being a capture, or the other way round`,
    )
  })
})

describe('saves from before', () => {
  it('stay as they are: posts lost before were never heard of', () => {
    const { world } = fixture()
    const v84 = migrateWorld(structuredClone(world), 83, { terrain })
    expect(v84).toEqual(world)
    expect(checkInvariants(v84, terrain)).toEqual([])
  })
})
