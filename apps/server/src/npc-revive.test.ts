import {
  CITY_AREA_MARGIN,
  FOOTPRINT,
  NPC_REVIVE_REACH,
  NPC_TOWN,
  WEAPONS,
  canWork,
  isDown,
  type Building,
  type City,
  type CityJob,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, putToWork, stepNpcCities, stopWork } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { farmersWanted, planCity } from './npc-plan.js'
import { npcRevivers } from './npc-revive.js'
import { mulberry32 } from './residents.js'
import { goDown } from './survival.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * An NPC city revives its own (`CONTEXT.md`: Reviving): one grown resident per Down resident in or
 * near its area, never a soldier and a spare hand first, while its storage holds Food.
 */

/** A town alone on Plains with plenty of Food, and its adults, nobody armed. */
function town() {
  const terrain = plains(400)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
  const storage = npcHome(world, city)!
  storage.stock = { ...storage.stock, food: 1000 }
  const adults = world.residents.filter((r) => r.cityId === city.id && canWork(r, world.tick))
  for (const r of adults) for (const w of WEAPONS) delete r.carried[w]
  return { world, terrain, city, storage, adults }
}

/** Those a plan sends to revive, as resident id → Down resident's id. */
function revivers(world: WorldState, city: City): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, job] of Object.entries(world.cityPlans[city.id]?.jobs ?? {})) {
    if (job.kind === 'revive') out[id] = job.targetId!
  }
  return out
}

/** Arms all of `people`, so they are soldiers. */
const arm = (people: Resident[]) => people.forEach((r) => (r.carried.spear = 1))

/** Lays `r` Down `tiles` outside the edge of the town's area, due east of its easternmost building. */
function laidOutside(world: WorldState, city: City, r: Resident, tiles: number) {
  const edge = Math.max(
    ...world.buildings
      .filter((b) => b.cityId === city.id)
      .map((b) => b.x + FOOTPRINT[b.kind] - 1 + CITY_AREA_MARGIN),
  )
  const home = npcHome(world, city)!
  r.x = edge + tiles
  r.y = home.y
  goDown(world, r)
}

describe('who goes', () => {
  it('sends one reviver, who wakes a Down resident near the area', () => {
    const { world, terrain, city, adults } = town()
    const down = adults[0]!
    laidOutside(world, city, down, 10)
    const walking = new Walking(terrain)
    for (let i = 0; i < 600 && isDown(down); i++) {
      stepWorld(world, terrain, walking)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(isDown(down)).toBe(false)
    expect(down.health).toBeGreaterThan(0)
  })

  it('fetches one near its area, but not one far out', () => {
    const { world, city, adults } = town()
    const [near, far] = adults
    laidOutside(world, city, near!, NPC_REVIVE_REACH)
    laidOutside(world, city, far!, NPC_REVIVE_REACH + 1)
    planCity(world, city)
    expect(Object.values(revivers(world, city))).toEqual([near!.id])
  })

  it('sends nobody with no Food in the storage, whatever they carry', () => {
    const { world, city, storage, adults } = town()
    storage.stock = { ...storage.stock, food: 0 }
    goDown(world, adults[0]!)
    planCity(world, city)
    expect(revivers(world, city)).toEqual({})
  })

  it('gets two revivers for two Down, and keeps them from pass to pass', () => {
    const { world, city, adults } = town()
    goDown(world, adults[0]!)
    goDown(world, adults[1]!)
    planCity(world, city)
    const first = revivers(world, city)
    expect(Object.values(first).sort()).toEqual([adults[0]!.id, adults[1]!.id].sort())
    expect(new Set(Object.values(first)).size).toBe(2)
    world.tick++
    planCity(world, city)
    expect(revivers(world, city)).toEqual(first)
  })

  it('replaces a reviver who goes Down, and gets one for them too', () => {
    const { world, city, adults } = town()
    const down = adults[0]!
    goDown(world, down)
    planCity(world, city)
    const reviver = world.residents.find((r) => revivers(world, city)[r.id])!
    goDown(world, reviver)
    world.tick++
    planCity(world, city)
    const now = revivers(world, city)
    expect(now[reviver.id]).toBeUndefined()
    expect(Object.values(now).sort()).toEqual([down.id, reviver.id].sort())
  })

  it('replaces a reviver who is killed', () => {
    const { world, city, adults } = town()
    const down = adults[0]!
    goDown(world, down)
    planCity(world, city)
    const reviverId = Object.keys(revivers(world, city))[0]!
    world.residents = world.residents.filter((r) => r.id !== reviverId)
    world.tick++
    planCity(world, city)
    const now = revivers(world, city)
    expect(Object.values(now)).toEqual([down.id])
    expect(now[reviverId]).toBeUndefined()
  })

  it('never sends a soldier', () => {
    const { world, city, adults } = town()
    const [down, ...others] = adults
    arm(others)
    goDown(world, down!)
    planCity(world, city)
    expect(revivers(world, city)).toEqual({})
  })

  it('never sends one carrying a child', () => {
    const { world, city, adults } = town()
    const [down, parent, ...others] = adults
    arm(others)
    parent!.carrying = { fatherId: 'someone', dueAt: world.tick + 1000 } as Resident['carrying']
    goDown(world, down!)
    planCity(world, city)
    expect(revivers(world, city)).toEqual({})
  })
})

describe('whom it takes', () => {
  /** A worker at a workplace, a builder and farmers, the rest armed. */
  function crew() {
    const t = town()
    const { world, city, adults } = t
    const farms = world.buildings.filter((b) => b.kind === 'farm' && b.cityId === city.id)
    // A town is founded with its first adults at the farms.
    adults.forEach(stopWork)
    const [down, spare, worker, ...others] = adults
    const wanted = farmersWanted(world, city)
    const farmers = others.slice(0, wanted)
    farmers.forEach((r, i) => putToWork(r, farms[i % farms.length]!))
    arm(others.slice(wanted))
    goDown(world, down!)
    return { ...t, farms, spare: spare!, worker: worker!, farmers }
  }

  /** A lumber camp of the city, with Wood short so that its worker stays a worker. */
  function camp(world: WorldState, city: City): Building {
    const home = npcHome(world, city)!
    const place = {
      id: 'camp',
      kind: 'lumberCamp',
      x: home.x + 30,
      y: home.y + 30,
      cityId: city.id,
    } as Building
    world.buildings.push(place)
    world.nodes.push({ id: 'wood', kind: 'forest', x: place.x, y: place.y })
    home.stock = { ...home.stock, wood: 0 }
    return place
  }

  it('takes a spare hand first', () => {
    const { world, city, spare, worker } = crew()
    putToWork(worker, camp(world, city))
    planCity(world, city)
    expect(Object.keys(revivers(world, city))).toEqual([spare.id])
  })

  it('takes a worker when no spare hand is left, and they leave off at once', () => {
    const { world, terrain, city, spare, worker } = crew()
    arm([spare])
    putToWork(worker, camp(world, city))
    planCity(world, city)
    expect(Object.keys(revivers(world, city))).toEqual([worker.id])
    stepNpcCities(world, terrain.size)
    expect(worker.script).toBeUndefined()
  })

  it('takes a builder after the workers, and they leave off at once', () => {
    const { world, terrain, city, spare, worker } = crew()
    arm([spare])
    worker.script = { scriptId: 0, task: 'build', memory: {} }
    planCity(world, city)
    expect(Object.keys(revivers(world, city))).toEqual([worker.id])
    stepNpcCities(world, terrain.size)
    expect(worker.script).toBeUndefined()
  })

  it('takes a farmer last, while Food is not short', () => {
    const { world, city, spare, worker, farmers } = crew()
    arm([spare, worker])
    planCity(world, city)
    const sent = Object.keys(revivers(world, city))
    expect(sent).toHaveLength(1)
    expect(farmers.map((r) => r.id)).toContain(sent[0])
  })

  it('leaves the farmers while Food is short', () => {
    const { world, city, storage, spare, worker } = crew()
    arm([spare, worker])
    storage.stock = { ...storage.stock, food: 1 }
    planCity(world, city)
    expect(revivers(world, city)).toEqual({})
  })

  it('still takes a spare hand while Food is short, once the farms have theirs', () => {
    const { world, city, storage, spare, worker, farmers } = crew()
    arm([worker])
    // Enough farmers for the one more it wants with no surplus, so the spare hand is left over.
    putToWork(
      spare,
      world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!,
    )
    const extra = world.residents.find(
      (r) => r.cityId === city.id && r.carried.spear && r !== worker,
    )!
    delete extra.carried.spear
    storage.stock = { ...storage.stock, food: 1 }
    planCity(world, city)
    const sent = Object.keys(revivers(world, city))
    expect(farmers.map((r) => r.id)).not.toEqual(expect.arrayContaining(sent))
    expect(sent).toEqual([extra.id])
  })

  it('gives those Down no job', () => {
    const { world, city, adults } = town()
    const down = adults[0]!
    goDown(world, down)
    planCity(world, city)
    expect(world.cityPlans[city.id]!.jobs[down.id]).toBeUndefined()
  })
})

describe('the reviver', () => {
  /** A town with one Down resident outside its area and the reviver its pass picked. */
  function sent() {
    const t = town()
    const { world, city, adults } = t
    const down = adults[0]!
    laidOutside(world, city, down, 10)
    planCity(world, city)
    const reviver = world.residents.find((r) => revivers(world, city)[r.id])!
    return { ...t, down, reviver }
  }

  it('takes the Food they give from the storage on top of their own', () => {
    const { world, terrain, storage, reviver } = sent()
    reviver.x = storage.x
    reviver.y = storage.y
    reviver.carried.food = 2
    stepNpcCities(world, terrain.size)
    expect(reviver.order).toMatchObject({ kind: 'pickUp', goods: { food: 2 } })
  })

  it('feeds them on arrival, and is called off when someone else got there first', () => {
    const { world, terrain, down, reviver } = sent()
    reviver.x = down.x
    reviver.y = down.y
    reviver.carried.food = 4
    stepNpcCities(world, terrain.size)
    expect(reviver.order).toMatchObject({ kind: 'feed', targetId: down.id })

    reviver.order = { kind: 'walkTo', target: { x: 0, y: 0 }, path: null, progress: 0 }
    delete down.downUntil
    down.health = 10
    stepNpcCities(world, terrain.size)
    expect(reviver.order?.kind).not.toBe('feed')
    expect(reviver.order).not.toMatchObject({ target: { x: 0, y: 0 } })
  })

  it('goes home when the one they went to has died', () => {
    const { world, terrain, down, reviver } = sent()
    world.residents = world.residents.filter((r) => r.id !== down.id)
    reviver.x = down.x + 40
    reviver.y = down.y
    reviver.carried.food = 4
    stepNpcCities(world, terrain.size)
    expect(reviver.order).toMatchObject({ kind: 'walkTo' })
    expect(reviver.order).not.toMatchObject({ target: { x: down.x, y: down.y } })
  })
})

describe('the Trade Organization', () => {
  it('revives its own the same way', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    const storage = npcHome(world, city)!
    storage.stock = { ...storage.stock, food: 500 }
    const people = world.residents.filter((r) => r.cityId === city.id && canWork(r, world.tick))
    const down = people[0]!
    const unarmed = people.find((r) => r !== down && !r.carried.spear)
    goDown(world, down)
    planCity(world, city)
    expect(Object.values(revivers(world, city))).toEqual(unarmed ? [down.id] : [])
  })
})

describe('the npc-revivers invariant', () => {
  /** A pass's plan just made with `jobs`. */
  function planned(jobs: (down: Resident, a: Resident, b: Resident) => Record<string, CityJob>) {
    const { world, terrain, city, adults } = town()
    const [down, a, b] = adults
    goDown(world, down!)
    world.cityPlans[city.id] = {
      plannedAt: world.tick,
      jobs: jobs(down!, a!, b!),
    }
    return { world, terrain, city, down: down!, a: a!, b: b! }
  }
  const revive = (target: Resident): CityJob => ({ kind: 'revive', targetId: target.id })

  it('passes one reviver per Down resident', () => {
    const { world, terrain } = planned((d, a) => ({ [a.id]: revive(d) }))
    expect(npcRevivers.check(world, terrain)).toEqual([])
  })

  it('finds two revivers of one', () => {
    const { world, terrain } = planned((d, a, b) => ({ [a.id]: revive(d), [b.id]: revive(d) }))
    expect(npcRevivers.check(world, terrain)).toHaveLength(1)
  })

  it('finds a soldier sent', () => {
    const { world, terrain, a } = planned((d, a) => ({ [a.id]: revive(d) }))
    a.carried.spear = 1
    expect(npcRevivers.check(world, terrain)).toHaveLength(1)
  })

  it('finds one sent too far', () => {
    const { world, terrain, city, down } = planned((d, a) => ({ [a.id]: revive(d) }))
    laidOutside(world, city, down, NPC_REVIVE_REACH + 1)
    expect(npcRevivers.check(world, terrain)).toHaveLength(1)
  })

  it('leaves a plan of an earlier tick alone', () => {
    const { world, terrain } = planned((d, a, b) => ({ [a.id]: revive(d), [b.id]: revive(d) }))
    world.tick++
    expect(npcRevivers.check(world, terrain)).toEqual([])
  })
})
