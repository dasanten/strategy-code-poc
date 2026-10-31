import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  AVERAGE_HORSE_STATS,
  ADMIN_MAP_INFO_PATH,
  ADMIN_PLACES_PATH,
  ADMIN_TERRITORY_PATH,
  ADMIN_VIEW_MAX_SIDE,
  SESSION_COOKIE,
  TRADE_ORGANIZATION,
  TRADE_ORG_NAME,
  Terrain,
  adminInspectPath,
  adminWorldPath,
  type AdminInspectKind,
  type AdminWorldView,
  type Caravan,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import {
  adminInspection,
  adminPlaces,
  adminWorldView,
  parseAdminView,
  type AdminLookups,
} from './admin-map.js'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, createSession, signUp } from './auth.js'
import { openDb, schema } from './db/index.js'
import { mulberry32, newResident } from './residents.js'
import { createScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
import { TerritoryTracker } from './territory.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const size = terrain.size

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  cityId: string,
  x: number,
  y: number,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  r.name = id
  world.residents.push(r)
  return r
}

/**
 * Realm r1 (Player 1, Leader a1 at the top right corner, army Vanguard) with city c1 at the top
 * left, in the alliance North; the self-managed city n1 in the middle with a horse; the Trade Org
 * HQ near the bottom right with a caravan from its trading post p1 standing in the corner; a pile.
 */
function setup(): WorldState {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'a1' })
  world.alliances.push({
    id: 'al1',
    name: 'North',
    leaderId: 'r1',
    members: [{ realmId: 'r1', joinedAt: 0 }],
    invites: [],
    army: [],
  })
  addCity(world, { id: 'c1', realmId: 'r1', x: 1, y: 1, name: 'Ashford' })
  addCity(world, { id: 'n1', realmId: null, x: 40, y: 40, name: 'Nook' }).formerPlayer = {
    userId: 2,
    tick: 0,
  }
  addCity(world, { id: 'hq', realmId: null, x: 50, y: 50, name: 'Exchange' }).tradeOrg = 'hq'
  addCity(world, { id: 'p1', realmId: null, x: 20, y: 50, name: 'Ferry' }).tradeOrg = 'post'
  resident(world, 'a1', 'r1', 'c1', 62, 2).script = { scriptId: 1, memory: { trips: 3 } }
  resident(world, 'n-1', null, 'n1', 40, 41)
  resident(world, 'd1', null, 'hq', 63, 63)
  world.horses.push({
    id: 'h1',
    realmId: null,
    cityId: 'n1',
    x: 41,
    y: 40,
    hunger: 100,
    health: 100,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  })
  world.carriages.push({
    id: 'k1',
    realmId: null,
    cityId: 'hq',
    x: 63,
    y: 63,
    horseId: null,
    load: {},
  })
  const caravan: Caravan = {
    id: 'cv1',
    postId: 'p1',
    carriageId: 'k1',
    driverId: 'd1',
    escortIds: [],
    heading: 'post',
    stop: 'storage',
    toLoad: null,
    holding: null,
    job: null,
    transfer: null,
  }
  world.caravans.push(caravan)
  world.armies.push({ id: 'ar1', name: 'Vanguard', realmId: 'r1', memberIds: ['a1'], order: null })
  world.piles.push({ id: 'pl1', x: 2, y: 2, goods: { wood: 4 } })
  return world
}

const lookups: AdminLookups = {
  accountOf: (userId) => (userId === 1 ? 'Mara' : undefined),
  scriptName: (scriptId) => (scriptId === 1 ? 'Miner' : undefined),
}

const ids = (view: AdminWorldView) => view.entities.map((e) => e.id).sort()

describe('admin world view', () => {
  it('gives every entity in a rectangle that wraps around the map edges', () => {
    const world = setup()
    // From (60, 60), 8 × 8 tiles: x and y 60–63 and 0–3, the four corners of the map.
    const view = adminWorldView(world, size, { x: 60, y: 60, w: 8, h: 8 }, lookups)
    expect(ids(view)).toEqual(['a1', 'ar1', 'c1', 'c1-hall', 'cv1', 'd1', 'k1', 'pl1'].sort())
    expect(view.tick).toBe(world.tick)
    // The same corner asked for from the other side of the edge.
    expect(ids(adminWorldView(world, size, { x: -4, y: -4, w: 8, h: 8 }, lookups))).toEqual(
      ids(view),
    )
    expect(ids(adminWorldView(world, size, { x: 38, y: 38, w: 6, h: 6 }, lookups))).toEqual([
      'h1',
      'n-1',
      'n1',
      'n1-hall',
    ])
  })

  it('tags each entity with its Organization and names those', () => {
    const world = setup()
    const view = adminWorldView(world, size, { x: 0, y: 0, w: 64, h: 64 }, lookups)
    const org = (id: string) => view.entities.find((e) => e.id === id)?.org
    expect(org('a1')).toBe('r1')
    expect(org('c1')).toBe('r1')
    expect(org('c1-hall')).toBe('r1')
    expect(org('ar1')).toBe('r1')
    expect(org('n-1')).toBe('n1')
    expect(org('h1')).toBe('n1')
    expect(org('hq')).toBe(TRADE_ORGANIZATION)
    expect(org('d1')).toBe(TRADE_ORGANIZATION)
    expect(org('k1')).toBe(TRADE_ORGANIZATION)
    expect(org('cv1')).toBe(TRADE_ORGANIZATION)
    expect(org('pl1')).toBeNull()
    expect(view.orgs).toEqual([
      { id: 'n1', is: 'city', name: 'Nook', alliance: null },
      {
        id: 'r1',
        is: 'realm',
        name: 'a1',
        account: 'Mara',
        alliance: { id: 'al1', name: 'North' },
      },
      { id: TRADE_ORGANIZATION, is: 'tradeOrg', name: TRADE_ORG_NAME, alliance: null },
    ])
  })

  it('shows a script by name and memory, never its source', () => {
    const view = adminWorldView(setup(), size, { x: 60, y: 0, w: 4, h: 4 }, lookups)
    const a1 = view.entities.find((e) => e.id === 'a1')
    expect(a1).toMatchObject({
      is: 'resident',
      script: { scriptId: 1, name: 'Miner', memory: { trips: 3 } },
    })
    expect(JSON.stringify(view)).not.toContain('source')
  })

  it('gives cities alone, where their town hall stands, for the far zoom', () => {
    const world = setup()
    // Nook has two houses and a house site; the site doesn't count.
    for (const [id, site] of [
      ['nh1', false],
      ['nh2', false],
      ['nh3', true],
    ] as const) {
      world.buildings.push({
        id,
        kind: 'house',
        cityId: 'n1',
        x: 41,
        y: 41,
        ...(site ? { site: { delivered: {}, work: 0 } } : {}),
      })
    }
    const view = adminWorldView(
      world,
      size,
      { x: 0, y: 0, w: 64, h: 64, citiesOnly: true },
      lookups,
    )
    expect(view.entities.map((e) => e.is)).toEqual(['city', 'city', 'city', 'city'])
    expect(view.entities.find((e) => e.id === 'n1')).toMatchObject({
      x: 40,
      y: 40,
      houses: 2,
      org: 'n1',
    })
    expect(view.entities.find((e) => e.id === 'c1')).toMatchObject({ houses: 0 })
  })

  it('reads a rectangle of whole numbers, capped unless for cities only', () => {
    const q = (x: number, y: number, w: number, h: number, citiesOnly = false) =>
      parseAdminView(
        Object.fromEntries(
          new URLSearchParams(adminWorldPath({ x, y, w, h, citiesOnly }).split('?')[1]),
        ),
        size,
      )
    expect(q(-5, 70, 10, 10)).toEqual({ x: -5, y: 70, w: 10, h: 10, citiesOnly: false })
    expect(parseAdminView({ x: '1', y: '1', w: '10', h: '10' }, 1000)).toMatchObject({ w: 10 })
    expect(
      parseAdminView({ x: '0', y: '0', w: String(ADMIN_VIEW_MAX_SIDE + 1), h: '1' }, 1000),
    ).toEqual(expect.any(String))
    expect(q(0, 0, 64, 64, true)).toMatchObject({ citiesOnly: true })
    expect(q(0, 0, 65, 64, true)).toEqual(expect.any(String))
    expect(q(0, 0, 0, 4)).toEqual(expect.any(String))
    expect(parseAdminView({ x: '1.5', y: '0', w: '4', h: '4' }, size)).toEqual(expect.any(String))
    expect(parseAdminView({ y: '0', w: '4', h: '4' }, size)).toEqual(expect.any(String))
  })
})

describe('admin places', () => {
  it('lists realms, NPC cities, the Trade Org and armies for the whole world', () => {
    expect(adminPlaces(setup(), lookups)).toEqual({
      tick: 0,
      realms: [
        {
          id: 'r1',
          account: 'Mara',
          name: 'a1',
          alliance: { id: 'al1', name: 'North' },
          leader: { id: 'a1', name: 'a1', x: 62, y: 2 },
          cities: [{ id: 'c1', name: 'Ashford', x: 1, y: 1 }],
        },
      ],
      npcCities: [{ id: 'n1', name: 'Nook', x: 40, y: 40, selfManaged: true, alliance: null }],
      tradeOrg: {
        hq: { id: 'hq', name: 'Exchange', x: 50, y: 50 },
        posts: [{ id: 'p1', name: 'Ferry', x: 20, y: 50 }],
        caravans: [{ id: 'cv1', name: 'Ferry', x: 63, y: 63, postId: 'p1', heading: 'post' }],
      },
      armies: [{ id: 'ar1', name: 'Vanguard', x: 62, y: 2, realmId: 'r1', realm: 'a1' }],
    })
  })
})

describe('admin inspection', () => {
  const inspect = (world: WorldState, kind: AdminInspectKind, id: string) =>
    adminInspection(world, { kind, id }, lookups)

  it('shows a resident with their Organization, city, army and script name, never its source', () => {
    const world = setup()
    world.residents[0]!.carried = { spear: 1, food: 2 }
    const r = inspect(world, 'resident', 'a1')!
    expect(r).toMatchObject({
      is: 'resident',
      org: { id: 'r1', is: 'realm', account: 'Mara' },
      city: { id: 'c1', name: 'Ashford' },
      army: { id: 'ar1', name: 'Vanguard' },
      caravan: null,
      leader: true,
      resident: { carried: { spear: 1, food: 2 }, script: { name: 'Miner', memory: { trips: 3 } } },
    })
    expect(inspect(world, 'resident', 'd1')).toMatchObject({
      org: { is: 'tradeOrg' },
      caravan: { id: 'cv1', name: 'Ferry' },
      leader: false,
    })
    expect(inspect(world, 'resident', 'gone')).toBeUndefined()
  })

  it('shows a city with its residents, buildings, storage, gates and soldiers', () => {
    const world = setup()
    world.buildings.push(
      { id: 's1', kind: 'storage', cityId: 'c1', x: 2, y: 1, stock: { wood: 5, food: 1 } },
      { id: 's2', kind: 'storage', cityId: 'c1', x: 3, y: 1, stock: { wood: 2 } },
      { id: 'g1', kind: 'gate', cityId: 'c1', x: 4, y: 1, closed: true },
      { id: 'g2', kind: 'gate', cityId: 'c1', x: 5, y: 1 },
      {
        id: 'h-site',
        kind: 'house',
        cityId: 'c1',
        x: 6,
        y: 1,
        site: { delivered: {}, work: 0 },
      },
    )
    resident(world, 'c1-a', 'r1', 'c1', 2, 2).carried = { sword: 1 }
    const c = inspect(world, 'city', 'c1')!
    expect(c).toMatchObject({
      is: 'city',
      org: { id: 'r1', is: 'realm' },
      city: { name: 'Ashford', x: 1, y: 1 },
      residents: [
        { id: 'a1', name: 'a1' },
        { id: 'c1-a', name: 'c1-a' },
      ],
      buildings: [
        ['gate', 2],
        ['storage', 2],
        ['townHall', 1],
      ],
      storage: { wood: 7, food: 1 },
      gates: { open: 1, shut: 1 },
      soldiers: 1,
    })
    expect(inspect(world, 'city', 'n1')).toMatchObject({ org: { id: 'n1', is: 'city' } })
    expect(inspect(world, 'city', 'hq')).toMatchObject({ org: { is: 'tradeOrg' } })
  })

  it('shows carriages, caravans, armies and the rest', () => {
    const world = setup()
    world.carriages[0]!.load = { iron: 3 }
    expect(inspect(world, 'carriage', 'k1')).toMatchObject({
      is: 'carriage',
      org: { is: 'tradeOrg' },
      carriage: { load: { iron: 3 } },
      driver: { id: 'd1' },
      caravan: { id: 'cv1', name: 'Ferry' },
    })
    expect(inspect(world, 'caravan', 'cv1')).toMatchObject({
      is: 'caravan',
      post: { id: 'p1', name: 'Ferry' },
      carriage: { id: 'k1' },
      crew: [{ id: 'd1' }],
    })
    world.armies[0]!.script = { scriptId: 1, memory: {} }
    expect(inspect(world, 'army', 'ar1')).toMatchObject({
      is: 'army',
      org: { id: 'r1' },
      army: { name: 'Vanguard', script: { name: 'Miner' } },
      members: [{ id: 'a1', x: 62, y: 2 }],
    })
    expect(inspect(world, 'building', 'c1-hall')).toMatchObject({
      org: { id: 'r1' },
      city: { name: 'Ashford' },
    })
    expect(inspect(world, 'horse', 'h1')).toMatchObject({ org: { id: 'n1' } })
    expect(inspect(world, 'pile', 'pl1')).toMatchObject({ org: null, pile: { goods: { wood: 4 } } })
  })
})

describe('admin map API', () => {
  async function start() {
    const opened = await openDb(':memory:')
    const world = setup()
    const territory = new TerritoryTracker()
    const app = await buildApp({
      db: opened.db,
      logger: false,
      secureCookies: false,
      trustProxy: false,
      world,
      terrain,
      territory,
    })
    // Daniel is an admin whose Player holds r1; Tobin is a Player.
    await createAdmin(opened.db, 'Daniel', 'admin password')
    const daniel = opened.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.name, 'Daniel'))
      .get()!
    world.realms[0]!.userId = daniel.id
    const script = createScript(opened.db, daniel.id, { name: 'Miner', source: 'secret source' })
    world.residents[0]!.script!.scriptId = script.id
    const tobin = await signUp(opened.db, {
      name: 'Tobin',
      password: 'correct horse',
      inviteCode: createInviteCode(opened.db, null),
    })
    const admin = { [SESSION_COOKIE]: createSession(opened.db, daniel.id) }
    const player = { [SESSION_COOKIE]: createSession(opened.db, tobin.id) }
    const get = (url: string, cookies?: Record<string, string>) =>
      app.inject({ method: 'GET', url, cookies })
    const close = async () => {
      await app.close()
      opened.close()
    }
    return { world, territory, admin, player, get, close }
  }

  it('gives admins the world, places and territory, and refuses everyone else', async () => {
    const { world, territory, admin, player, get, close } = await start()
    const worldUrl = adminWorldPath({ x: 60, y: 60, w: 8, h: 8 })

    const view = await get(worldUrl, admin)
    expect(view.statusCode).toBe(200)
    expect(view.json().entities.find((e: { id: string }) => e.id === 'a1').script).toMatchObject({
      name: 'Miner',
      memory: { trips: 3 },
    })
    expect(view.body).not.toContain('secret source')
    expect(view.json().orgs.find((o: { id: string }) => o.id === 'r1').account).toBe('Daniel')
    expect((await get(adminWorldPath({ x: 0, y: 0, w: 300, h: 4 }), admin)).statusCode).toBe(400)
    expect(
      (await get(adminWorldPath({ x: 0, y: 0, w: 64, h: 64, citiesOnly: true }), admin)).statusCode,
    ).toBe(200)

    const map = await get(ADMIN_MAP_INFO_PATH, admin)
    expect(map.json()).toEqual({ seed: world.seed, size })

    const places = await get(ADMIN_PLACES_PATH, admin)
    expect(places.statusCode).toBe(200)
    expect(places.json().tradeOrg.hq.name).toBe('Exchange')

    const inspectUrl = adminInspectPath({ kind: 'resident', id: 'a1' })
    const inspected = await get(inspectUrl, admin)
    expect(inspected.statusCode).toBe(200)
    expect(inspected.json().resident.script.name).toBe('Miner')
    expect(inspected.body).not.toContain('secret source')
    expect((await get(adminInspectPath({ kind: 'city', id: 'gone' }), admin)).statusCode).toBe(404)
    expect((await get('/api/admin/inspect/realm/r1', admin)).statusCode).toBe(400)

    expect((await get(ADMIN_TERRITORY_PATH, admin)).statusCode).toBe(404)
    territory.update(world, terrain)
    const region = await get(ADMIN_TERRITORY_PATH, admin)
    expect(region.statusCode).toBe(200)
    const holders = region.json().holders.map((h: { id: string; name: string }) => [h.id, h.name])
    expect(holders).toEqual(
      expect.arrayContaining([
        ['r1', 'a1'],
        ['n1', 'Nook'],
        [TRADE_ORGANIZATION, TRADE_ORG_NAME],
      ]),
    )

    for (const url of [
      ADMIN_MAP_INFO_PATH,
      worldUrl,
      ADMIN_PLACES_PATH,
      ADMIN_TERRITORY_PATH,
      inspectUrl,
    ]) {
      const refused = await get(url, player)
      expect(refused.statusCode).toBe(403)
      expect(refused.json().error).toBe('not-admin')
      expect((await get(url)).statusCode).toBe(401)
    }
    await close()
  })

  it("changes nothing in the world or in a Player's sight-limited sync", async () => {
    const { world, territory, admin, get, close } = await start()
    territory.update(world, terrain)
    const before = JSON.stringify(world)
    const sightBefore = entitiesInSight(world, terrain, 'r1')
    for (const url of [
      adminWorldPath({ x: 0, y: 0, w: 64, h: 64 }),
      adminWorldPath({ x: 0, y: 0, w: 64, h: 64, citiesOnly: true }),
      ADMIN_PLACES_PATH,
      ADMIN_TERRITORY_PATH,
      adminInspectPath({ kind: 'city', id: 'c1' }),
      adminInspectPath({ kind: 'army', id: 'ar1' }),
    ]) {
      expect((await get(url, admin)).statusCode).toBe(200)
    }
    expect(JSON.stringify(world)).toBe(before)
    // The admin's own Player still sees only what their residents see. (On the 10 m grid their
    // sight covers most of this small map, so this compares with before instead of naming places.)
    const sight = entitiesInSight(world, terrain, 'r1')
    expect(sight).toEqual(sightBefore)
    await close()
  })
})
