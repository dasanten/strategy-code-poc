import {
  NPC_PATROLS_MAX,
  NPC_PATROL_ROAD_STOPS,
  NPC_PATROL_WALL_STOPS,
  NPC_SOLDIERS_ON_HALL,
  NPC_SOLDIERS_PER_PATROL,
  NPC_VILLAGE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  isAt,
  tileIndex,
  townHallOf,
  type Building,
  type City,
  type CityPlan,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { startAlarm } from './alarms.js'
import { checkInvariants } from './invariants.js'
import { stepNpcCities, npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { nextStop, npcPatrolsSound, patrolsWanted, sharePatrols } from './npc-patrols.js'
import { planCity } from './npc-plan.js'
import { freeSoldiers } from './npc-posts.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const SIZE = 128

/** A city alone on an open map, its residents free and on its storage, `armed` of them with spears. */
function staged(
  armed: number,
  residents = 40,
): { world: WorldState; terrain: TerrainMap; city: City; storage: Building; hall: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, { ...NPC_VILLAGE, residents }, 30, 30, mulberry32(7))
  const storage = npcHome(world, city)!
  const hall = townHallOf(world, city)!
  world.residents.forEach((r, i) => {
    Object.assign(r, { x: storage.x, y: storage.y, order: null, carried: { food: OWN_FOOD } })
    delete r.script
    delete r.weapon
    if (i < armed) r.carried.spear = 1
  })
  return { world, terrain, city, storage, hall }
}

/** The city's soldiers, in order of id. */
const soldiersOf = (world: WorldState) =>
  world.residents.filter((r) => r.carried.spear).sort((a, b) => (a.id < b.id ? -1 : 1))

/** Runs the city's pass and one tick of its behaviour. */
function pass(world: WorldState, city: City): void {
  planCity(world, city)
  stepNpcCities(world, SIZE)
}

/** Stands everyone with a walk where it ends. */
function arrive(world: WorldState): void {
  for (const r of world.residents) {
    if (r.order?.kind !== 'walkTo') continue
    r.x = r.order.target.x
    r.y = r.order.target.y
    r.order = null
  }
}

/** A city staged with its soldiers on their posts, and its first rounds just begun. */
function onPosts(armed: number, residents = 40) {
  const s = staged(armed, residents)
  pass(s.world, s.city)
  arrive(s.world)
  pass(s.world, s.city)
  return { ...s, plan: s.world.cityPlans[s.city.id]! }
}

const patrollers = (plan: CityPlan) => plan.patrols?.map((p) => p.residentId) ?? []

const byId = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

const tile = (t: { x: number; y: number }) => `${t.x},${t.y}`

describe('Patrols (CONTEXT.md: Soldier posts)', () => {
  it('sends a share of those on the wall, up to the limit, however many there are', () => {
    expect(patrolsWanted(NPC_SOLDIERS_PER_PATROL - 1)).toBe(0)
    expect(patrolsWanted(NPC_SOLDIERS_PER_PATROL)).toBe(1)
    expect(patrolsWanted(1000)).toBe(NPC_PATROLS_MAX)
  })

  it('takes them from the wall: those on the hall and at the gate stay', () => {
    const { world, plan } = onPosts(11)
    const ids = soldiersOf(world).map((r) => r.id)
    const held = ids.slice(0, NPC_SOLDIERS_ON_HALL + 1)
    const onWall = ids.length - held.length
    expect(patrollers(plan)).toHaveLength(patrolsWanted(onWall))
    for (const id of held) expect(patrollers(plan)).not.toContain(id)
  })

  it('sends none from a city with too few on its wall', () => {
    const { plan } = onPosts(NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_PER_PATROL)
    expect(plan.patrols).toBeUndefined()
  })

  it('walks the wall in stops, then the roads, and back where they set out from', () => {
    const { world, plan } = onPostsWithRoad(11)
    const round = plan.patrols![0]!
    const r = byId(world, round.residentId)
    const walls = new Set(world.buildings.filter((b) => b.kind === 'wall').map(tile))
    const roads = new Set(world.buildings.filter((b) => b.kind === 'road').map(tile))
    // The first stop is the walk they are on already.
    const first = r.order?.kind === 'walkTo' ? r.order.target : undefined
    const stops = [first!, ...round.stops]
    expect(stops).toHaveLength(NPC_PATROL_WALL_STOPS + NPC_PATROL_ROAD_STOPS + 1)
    const between = stops.slice(0, -1)
    expect(between.filter((s) => walls.has(tile(s)))).toHaveLength(NPC_PATROL_WALL_STOPS)
    expect(between.filter((s) => roads.has(tile(s)))).toHaveLength(NPC_PATROL_ROAD_STOPS)
    // No stop twice, and the wall's spread right round the hall rather than bunched on one side.
    expect(new Set(between.map(tile)).size).toBe(between.length)
    const hall = townHallOf(world, world.cities[0]!)!
    const along = between.filter((s) => walls.has(tile(s)))
    expect(along.some((s) => s.x < hall.x)).toBe(true)
    expect(along.some((s) => s.x > hall.x)).toBe(true)
    expect(along.some((s) => s.y < hall.y)).toBe(true)
    expect(along.some((s) => s.y > hall.y)).toBe(true)
    // They end where they set out from, on the wall.
    expect(walls.has(tile(stops.at(-1)!))).toBe(true)
  })

  it('leaves a road out to a far workplace, past its wall, alone', () => {
    const { world, city } = staged(11)
    const far = { x: 100, y: 30 }
    world.buildings.push({ id: 'far', kind: 'road', cityId: null, ...far })
    pass(world, city)
    arrive(world)
    pass(world, city)
    const plan = world.cityPlans[city.id]!
    for (const p of plan.patrols!) expect(p.stops.map(tile)).not.toContain(tile(far))
  })

  it('walks only the longer ring of a city with two', () => {
    const { world, city, hall } = staged(11)
    // An inner ring of two stretches round the hall, with a gate of its own.
    for (let i = 0; i < 4; i++) {
      const at = { x: hall.x - 2 + i, y: hall.y - 2 }
      const kind = i === 0 ? ('gate' as const) : ('wall' as const)
      world.buildings.push({ id: `in${i}`, kind, cityId: city.id, ...at })
    }
    pass(world, city)
    arrive(world)
    pass(world, city)
    const inner = new Set(world.buildings.filter((b) => b.id.startsWith('in')).map(tile))
    const plan = world.cityPlans[city.id]!
    expect(plan.patrols?.length).toBeGreaterThan(0)
    for (const p of plan.patrols!) {
      for (const s of p.stops.slice(0, -1)) expect(inner.has(tile(s))).toBe(false)
    }
  })

  it('walks the roads alone in a city with no wall, and not at all with neither', () => {
    const { world, city, hall } = staged(11)
    world.buildings = world.buildings.filter((b) => b.kind !== 'wall' && b.kind !== 'gate')
    pass(world, city)
    arrive(world)
    pass(world, city)
    const plan = world.cityPlans[city.id]!
    expect(plan.patrols).toBeUndefined()

    arrive(world)
    for (let i = 0; i < 5; i++) {
      world.buildings.push({
        id: `rd${i}`,
        kind: 'road',
        cityId: null,
        x: hall.x + 4 + i,
        y: hall.y,
      })
    }
    pass(world, city)
    expect(plan.patrols?.length).toBeGreaterThan(0)
    const [round] = plan.patrols!
    expect(round!.stops.length).toBeLessThanOrEqual(NPC_PATROL_ROAD_STOPS + 1)
  })

  it('does not call a walk off at the next pass, and gives them no post meanwhile', () => {
    const { world, city, plan } = onPosts(11)
    const r = byId(world, patrollers(plan)[0]!)
    const walk = r.order
    expect(walk).toMatchObject({ kind: 'walkTo' })
    world.tick++
    pass(world, city)
    expect(r.order).toBe(walk)
    expect(freeSoldiers(world, city, world.residents).map((s) => s.id)).not.toContain(r.id)
  })

  it('takes the next by id when a round ends, after the last, and comes round again', () => {
    const { world, city, plan } = onPosts(NPC_SOLDIERS_ON_HALL + 1 + 2 * NPC_SOLDIERS_PER_PATROL)
    const onWall = soldiersOf(world)
      .slice(NPC_SOLDIERS_ON_HALL + 1)
      .map((r) => r.id)
    const wanted = patrolsWanted(onWall.length)
    expect(wanted).toBeGreaterThanOrEqual(2)
    const set: string[] = [...patrollers(plan)]
    for (let turn = 0; set.length < onWall.length + wanted; turn++) {
      expect(turn).toBeLessThan(onWall.length * 2)
      for (const r of world.residents) {
        if (patrollers(plan).includes(r.id)) {
          const round = plan.patrols!.find((p) => p.residentId === r.id)!
          const back = round.stops.at(-1)!
          Object.assign(r, { x: back.x, y: back.y, order: null })
        }
      }
      plan.patrols = plan.patrols?.map((p) => ({ ...p, stops: [] }))
      // The tick that sees their stops gone ends their rounds, and the pass after sets the next off.
      stepNpcCities(world, SIZE)
      expect(plan.patrols).toBeUndefined()
      world.tick++
      pass(world, city)
      set.push(...patrollers(plan))
    }
    // Everyone once before anyone twice, in order of id.
    expect(set.slice(0, onWall.length)).toEqual(onWall)
    expect(set.slice(onWall.length, onWall.length + wanted)).toEqual(onWall.slice(0, wanted))
  })

  it('leaves out one still walking back to their post, and gives the turn to the next', () => {
    const { world, city } = staged(NPC_SOLDIERS_ON_HALL + 1 + NPC_SOLDIERS_PER_PATROL)
    pass(world, city)
    arrive(world)
    const first = soldiersOf(world)[NPC_SOLDIERS_ON_HALL + 1]!
    first.x -= 1
    first.order = {
      kind: 'walkTo',
      target: { x: first.x + 1, y: first.y },
      path: null,
      progress: 0,
    }
    pass(world, city)
    expect(patrollers(world.cityPlans[city.id]!)).not.toContain(first.id)
  })

  it('ends the round of one no longer a soldier at hand, as one the pass sends to train', () => {
    const { world, city, plan } = onPosts(11)
    const adults = world.residents.filter((r) => r.health > 0)
    const [id] = patrollers(plan)
    plan.jobs[id!] = { kind: 'idle' }
    sharePatrols(world, city, plan, adults, SIZE)
    expect(patrollers(plan)).not.toContain(id)
  })

  it('ends every round when its hall comes down or it turns Trade Org', () => {
    const { world, city, plan, hall } = onPosts(11)
    expect(plan.patrols).toBeDefined()
    hall.site = { materials: {}, delivered: {}, work: 0 } as unknown as Building['site']
    sharePatrols(world, city, plan, world.residents, SIZE)
    expect(plan.patrols).toBeUndefined()
  })

  it('a Trade Org city sends none', () => {
    const { world, city } = staged(11)
    city.tradeOrg = 'post'
    pass(world, city)
    arrive(world)
    pass(world, city)
    expect(world.cityPlans[city.id]!.patrols).toBeUndefined()
  })

  it('keeps as plain data', () => {
    const { plan } = onPosts(11)
    expect(JSON.parse(JSON.stringify(plan.patrols))).toEqual(plan.patrols)
    expect(typeof plan.patrolledLast).toBe('string')
  })

  it('takes the stops in order, and a round with none left goes off the plan', () => {
    const plan: CityPlan = {
      plannedAt: 0,
      jobs: {},
      patrols: [{ residentId: 'a', stops: [{ x: 1, y: 2 }] }],
    }
    const a = { id: 'a' } as Resident
    expect(nextStop(plan, a)).toEqual({ x: 1, y: 2 })
    expect(plan.patrols).toHaveLength(1)
    expect(nextStop(plan, a)).toBeUndefined()
    expect(plan.patrols).toBeUndefined()
    expect(nextStop(plan, a)).toBeUndefined()
  })
})

describe('Patrols and Food', () => {
  it('sends one running low with none to take back to their post, and ends the round', () => {
    const { world, city, plan, storage } = onPosts(11)
    const r = byId(world, patrollers(plan)[0]!)
    storage.stock = { ...storage.stock, food: 0 }
    r.carried.food = 0.5
    world.tick++
    pass(world, city)
    expect(patrollers(plan)).not.toContain(r.id)
  })

  it('brings one low on Food in from outside its area, and they refill there', () => {
    const { world, terrain, city, plan } = onPosts(11)
    const r = byId(world, patrollers(plan)[0]!)
    Object.assign(r, { x: 100, y: 100 })
    r.carried.food = 0.5
    world.tick++
    pass(world, city)
    expect(patrollers(plan)).not.toContain(r.id)
    expect(r.order).toMatchObject({ kind: 'walkTo' })
    const walking = new Walking(terrain)
    for (let t = 0; t < 2 * TICKS_PER_GAME_DAY && (r.carried.food ?? 0) < 1; t++) {
      stepWorld(world, terrain, walking)
    }
    expect(r.health).toBeGreaterThan(0)
    expect(r.carried.food ?? 0).toBeGreaterThanOrEqual(0.5)
  })

  it('goes on with a round while the storage has Food', () => {
    const { world, city, plan } = onPosts(11)
    const r = byId(world, patrollers(plan)[0]!)
    r.carried.food = 0.5
    world.tick++
    pass(world, city)
    expect(patrollers(plan)).toContain(r.id)
  })
})

describe('Patrols, in the running world', { timeout: 300_000 }, () => {
  /** Those armed walking anywhere, once all are on their posts: what a patrol adds. */
  const walkers = (world: WorldState) =>
    soldiersOf(world).filter((r) => r.order?.kind === 'walkTo' || r.order?.kind === 'climb')

  it('no more than the limit walk at once, they take turns and nobody starves', () => {
    const armed = NPC_SOLDIERS_ON_HALL + 1 + 2 * NPC_SOLDIERS_PER_PATROL
    const { world, terrain, city, hall } = staged(armed)
    const walking = new Walking(terrain)
    const soldiers = soldiersOf(world)
    for (const r of soldiers) r.carried.food = 2
    const onWall = soldiers.slice(NPC_SOLDIERS_ON_HALL + 1).map((r) => r.id)
    const wanted = patrolsWanted(onWall.length)
    const set: string[] = []
    let most = 0
    let was: string[] = []
    for (let t = 0; t < 6 * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      if (t % 20 === 0) expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
      const plan = world.cityPlans[city.id]
      const now = plan ? patrollers(plan) : []
      expect(now.length).toBeLessThanOrEqual(wanted)
      set.push(...now.filter((id) => !was.includes(id)))
      was = now
      // They all reach their posts in the first game day, and then only patrols walk, and the hall
      // is held all along.
      if (t > TICKS_PER_GAME_DAY) {
        most = Math.max(most, walkers(world).length)
        expect(soldiers.filter((r) => isAt(r, hall, SIZE)).length).toBeGreaterThanOrEqual(1)
      }
    }
    expect(most).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(wanted)
    // Everyone on the wall has had a round before anyone a second, in their order of id: those
    // quickest to their posts go first, and the turn goes on round from there.
    expect(set.length).toBeGreaterThan(onWall.length)
    const from = onWall.indexOf(set[0]!)
    const inOrder = onWall.map((_, i) => onWall[(from + i) % onWall.length])
    expect(set.slice(0, onWall.length)).toEqual(inOrder)
    expect(set[onWall.length]).toBe(set[0])
    for (const r of soldiers) {
      expect(r.health).toBeGreaterThan(0)
      expect(r.carried.food ?? 0).toBeGreaterThan(0)
    }
  })

  it('a walled-in round doesn’t stick: its stops go by and the next takes a turn', () => {
    const { world, terrain, city } = staged(NPC_SOLDIERS_ON_HALL + 1 + 2 * NPC_SOLDIERS_PER_PATROL)
    pass(world, city)
    arrive(world)
    const plan = world.cityPlans[city.id]!
    const first = soldiersOf(world)[NPC_SOLDIERS_ON_HALL + 1]!
    // Sea all round the tile they stand on, with no way off it.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        terrain.tiles[tileIndex(SIZE, first.x + dx, first.y + dy)] = Terrain.Sea
      }
    }
    const at = tile(first)
    const walking = new Walking(terrain)
    let was = false
    let gone = -1
    for (let t = 0; t < 180 && gone < 0; t++) {
      stepWorld(world, terrain, walking)
      if (patrollers(plan).includes(first.id)) was = true
      else if (was) gone = t
    }
    expect(was).toBe(true)
    expect(gone).toBeGreaterThanOrEqual(0)
    expect(tile(first)).toBe(at)
    expect(first.order).toBeNull()
    // Their turn is over: the next is on their way, and they stand where they were.
    for (let t = 0; t < 120; t++) stepWorld(world, terrain, walking)
    expect(patrollers(plan)).not.toContain(first.id)
    expect(plan.patrolledLast! > first.id).toBe(true)
  })

  it('an alarm takes one off a round, and they go on with it after', () => {
    const { world, terrain, city, plan } = onPosts(11)
    const walking = new Walking(terrain)
    const r = byId(world, patrollers(plan)[0]!)
    for (let t = 0; t < 30; t++) stepWorld(world, terrain, walking)
    const before = plan.patrols!.find((p) => p.residentId === r.id)!.stops.length
    startAlarm(world, r, {
      kind: 'outsider',
      cityId: city.id,
      about: 'x',
      realmId: null,
      x: r.x,
      y: r.y,
      tick: world.tick,
    })
    expect(r.script?.task).toBe('alarm')
    expect(r.order).toBeNull()
    expect(r.interrupted?.order).toMatchObject({ kind: 'walkTo' })
    expect(patrollers(plan)).toContain(r.id)

    // Nobody about it is there: their Alarm script ends, and they go on where they left off.
    let on = false
    for (let t = 0; t < TICKS_PER_GAME_DAY && !on; t++) {
      stepWorld(world, terrain, walking)
      on = r.script === undefined && r.order?.kind === 'walkTo'
    }
    expect(on).toBe(true)
    expect(patrollers(plan)).toContain(r.id)
    const after = plan.patrols!.find((p) => p.residentId === r.id)!.stops.length
    expect(after).toBeLessThanOrEqual(before)
    expect(after).toBeGreaterThan(0)
  })

  it('an outsider in sight breaks a round off for the hall, and the round ends back on the wall', () => {
    const { world, terrain, city, plan } = onPosts(11)
    const walking = new Walking(terrain)
    const r = byId(world, patrollers(plan)[0]!)
    const leader = newResident(mulberry32(91), {
      id: 'leader',
      owner: 'r1',
      cityId: null,
      x: 100,
      y: 100,
      tick: world.tick,
    })
    leader.bornAt = world.tick - 20 * 24 * 3600
    leader.lifespan = 60
    world.residents.push(leader)
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'leader' })
    const p = newResident(mulberry32(92), {
      id: 'p1',
      owner: 'r1',
      cityId: null,
      x: r.x - 3,
      y: r.y,
      tick: world.tick,
    })
    p.bornAt = leader.bornAt
    p.lifespan = 60
    p.carried.sword = 1
    world.residents.push(p)
    let alarmed = false
    for (let t = 0; t < 60 && !alarmed; t++) {
      stepWorld(world, terrain, walking)
      alarmed = r.script?.task === 'alarm'
    }
    expect(alarmed).toBe(true)
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
    Object.assign(p, { x: 100, y: 100 })
    let ended = false
    for (let t = 0; t < 4 * TICKS_PER_GAME_DAY && !ended; t++) {
      stepWorld(world, terrain, walking)
      ended = !patrollers(plan).includes(r.id)
    }
    expect(ended).toBe(true)
    expect(city.occupation ?? null).toBeNull()
  })
})

describe('npcPatrolsSound', () => {
  const stops = [{ x: 1, y: 1 }]

  it('holds in a city with its rounds under way', () => {
    const { world, terrain, plan } = onPosts(11)
    expect(plan.patrols).toBeDefined()
    world.tick = plan.plannedAt + 1
    expect(npcPatrolsSound.check(world, terrain)).toEqual([])
  })

  it('catches too many at once, one on two rounds, and a round too long', () => {
    const { world, terrain, city, plan } = onPosts(11)
    plan.patrols = Array.from({ length: NPC_PATROLS_MAX + 1 }, () => ({
      residentId: 'same',
      stops: Array.from({ length: 50 }, () => stops[0]!),
    }))
    const found = npcPatrolsSound.check(world, terrain).map((v) => v.message)
    expect(found).toContain(`${city.id} has ${NPC_PATROLS_MAX + 1} on patrol at once`)
    expect(found).toContain(`${city.id} has a soldier on two rounds`)
    expect(found).toContain(`${city.id} has a round of 50 stops`)
  })

  it('catches an empty list, and rounds in a Trade Org city', () => {
    const { world, terrain, city, plan } = onPosts(11)
    plan.patrols = []
    expect(npcPatrolsSound.check(world, terrain).map((v) => v.message)).toEqual([
      `${city.id} keeps an empty list of patrols`,
    ])
    plan.patrols = [{ residentId: 'a', stops }]
    city.tradeOrg = 'post'
    expect(npcPatrolsSound.check(world, terrain).map((v) => v.message)).toEqual([
      `${city.id} is the Trade Org’s, and has patrols`,
    ])
  })

  it('catches someone else on patrol right after a pass, and only then', () => {
    const { world, terrain, city, plan } = onPosts(11)
    const r = byId(world, patrollers(plan)[0]!)
    r.cityId = 'elsewhere'
    world.tick = plan.plannedAt + 30
    expect(npcPatrolsSound.check(world, terrain)).toEqual([])
    world.tick = plan.plannedAt + 1
    expect(npcPatrolsSound.check(world, terrain).map((v) => v.message)).toEqual([
      `${city.id} has ${r.id} on patrol, who isn’t its own`,
    ])
  })
})

/** `onPosts`, in a city with a road across it inside its wall. */
function onPostsWithRoad(armed: number) {
  const s = staged(armed)
  for (let i = 0; i < 8; i++) {
    const at = { x: s.hall.x + 3 + i, y: s.hall.y + 6 }
    if (s.world.buildings.some((b) => b.x === at.x && b.y === at.y)) continue
    s.world.buildings.push({ id: `rd${i}`, kind: 'road', cityId: null, ...at })
  }
  pass(s.world, s.city)
  arrive(s.world)
  pass(s.world, s.city)
  return { ...s, plan: s.world.cityPlans[s.city.id]! }
}
