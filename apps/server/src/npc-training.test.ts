import {
  BUILD_MATERIALS,
  NPC_SOLDIERS_ON_HALL,
  NPC_TRAIN_TURN_TICKS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  TRAINING_GROUND_MAX_TRAINEES,
  canWork,
  isAt,
  isDown,
  npcReserve,
  statValue,
  teacherAt,
  townHallOf,
  traineesOf,
  type Building,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { bigCity, unhurriedWalking } from './npc-big-city.fixture.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { houseTile, nextProject, wallRings } from './npc-growth.js'
import { plains } from './npc-growth.fixture.js'
import { sharePatrols } from './npc-patrols.js'
import { planCity, runResidents } from './npc-plan.js'
import { postsToHold, soldiersAtHand } from './npc-posts.js'
import {
  cityGround,
  npcTrainingGroundsBounded,
  npcTrainsItsSoldiers,
  planTraining,
  steerTraining,
} from './npc-training.js'
import { npcSender } from './order-sender.js'
import { mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { teach } from './teaching.js'
import { train } from './training.js'
import { stepWorld } from './world.js'

type Staged = ReturnType<typeof bigCity>

/** A finished training ground where the city would put one, its own by standing in its area. */
function withGround({ world, terrain, city, home }: Staged): Building {
  const rings = wallRings(world, city, home, terrain.size)
  const at = houseTile(world, city, home, terrain, rings, 'trainingGround')!
  const ground: Building = {
    id: newId(world, 'b'),
    kind: 'trainingGround',
    cityId: null,
    x: at.x,
    y: at.y,
  }
  world.buildings.push(ground)
  return ground
}

/** A stable of the city, so that isn't what it wants first; out of the way, past its wall. */
function withStable({ world, city, home }: Staged): void {
  world.buildings.push({
    id: newId(world, 'b'),
    kind: 'stable',
    cityId: city.id,
    x: home.x - 40,
    y: home.y - 40,
  })
}

/** An armed grown resident of a realm at `at`, their Leader off at `away`. */
function armedOutsider(
  world: WorldState,
  at: { x: number; y: number },
  away: { x: number; y: number },
): Resident {
  const make = (id: string, where: { x: number; y: number }) => {
    const r = newResident(mulberry32(world.residents.length + 1), {
      id,
      owner: 'r1',
      cityId: null,
      x: where.x,
      y: where.y,
      tick: world.tick,
    })
    r.bornAt = world.tick - 20 * 24 * 3600
    r.lifespan = 60
    world.residents.push(r)
    return r
  }
  make('leader', away)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'leader' })
  const r = make('outsider', at)
  r.carried.sword = 1
  return r
}

const soldiersOf = (world: WorldState, city: City) =>
  world.residents.filter((r) => r.cityId === city.id && r.carried.spear)

const jobsOf = (world: WorldState, city: City, kind: string) =>
  Object.entries(world.cityPlans[city.id]?.jobs ?? {})
    .filter(([, j]) => j.kind === kind)
    .map(([id]) => id)

describe('a big NPC city’s training ground (`CONTEXT.md`: Bigger projects)', () => {
  it('is its next project once nothing is short and it holds the materials above its reserve', () => {
    const staged = bigCity()
    const { world, terrain, city, home } = staged
    withStable(staged)
    expect(nextProject(world, city, home, terrain)).toMatchObject({
      kind: 'build',
      building: 'trainingGround',
    })
  })

  it('waits while it holds the materials only by eating into its reserve', () => {
    const staged = bigCity()
    const { world, terrain, city, home } = staged
    withStable(staged)
    const needs = BUILD_MATERIALS.trainingGround!
    home.stock!.wood = (npcReserve(world, city).wood ?? 0) + (needs.wood ?? 0) - 1
    expect(nextProject(world, city, home, terrain)).not.toMatchObject({
      building: 'trainingGround',
    })
  })

  it('is not built twice: with one standing or begun in its area it wants no other', () => {
    const staged = bigCity()
    const { world, terrain, city, home } = staged
    withStable(staged)
    const ground = withGround(staged)
    expect(nextProject(world, city, home, terrain)).not.toMatchObject({
      building: 'trainingGround',
    })
    // Begun, it goes on building that one, first of all.
    ground.site = { materials: {}, delivered: {}, work: 0 } as never
    expect(nextProject(world, city, home, terrain)).toMatchObject({
      building: 'trainingGround',
      x: ground.x,
      y: ground.y,
    })
    expect(cityGround(world, city, terrain.size)?.id).toBe(ground.id)
  })

  it('is no project of a village, however much it holds', () => {
    const terrain = plains(240)
    const staged = bigCity(undefined, 240)
    const { world } = staged
    const city = foundNpcCity(
      world,
      terrain,
      { ...NPC_VILLAGE, residents: 20 },
      180,
      180,
      mulberry32(3),
    )
    const home = npcHome(world, city)!
    home.stock = { ...npcReserve(world, city), wood: 2000, stone: 2000, food: 2000 }
    expect(nextProject(world, city, home, terrain)).not.toMatchObject({
      building: 'trainingGround',
    })
  })

  it(
    'goes up on a run of the staged city, one only, with no invariant broken',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city } = bigCity()
      const walking = unhurriedWalking(terrain)
      let built = false
      for (let t = 0; t < 12 * TICKS_PER_GAME_DAY; t++) {
        stepWorld(world, terrain, walking)
        if (t % 60 === 0) expect(checkInvariants(world, terrain)).toEqual([])
        const grounds = world.buildings.filter((b) => b.kind === 'trainingGround')
        expect(grounds.length).toBeLessThanOrEqual(1)
        if (grounds[0] && !grounds[0].site) {
          built = true
          break
        }
      }
      expect(built).toBe(true)
      expect(cityGround(world, city, terrain.size)).toBeDefined()
    },
  )
})

describe('who trains (`CONTEXT.md`: Who trains)', () => {
  it('has the soldier with the most Combat teach it, and as many as there is room for train', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    const ground = withGround(staged)
    const soldiers = soldiersOf(world, city)
    soldiers[7]!.skills.combat = 4
    soldiers[9]!.skills.combat = 2
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([soldiers[7]!.id])
    expect(world.cityPlans[city.id]!.jobs[soldiers[7]!.id]).toEqual({
      kind: 'teach',
      groundId: ground.id,
      subject: 'combat',
    })
    expect(jobsOf(world, city, 'train')).toHaveLength(TRAINING_GROUND_MAX_TRAINEES)
  })

  it('teaches Strength under a teacher with no Combat, the strongest of them', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const soldiers = soldiersOf(world, city)
    for (const r of soldiers) r.stats.strength = { base: 10, trained: 0 }
    soldiers[3]!.stats.strength = { base: 14, trained: 0 }
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([soldiers[3]!.id])
    expect(world.cityPlans[city.id]!.jobs[soldiers[3]!.id]!.subject).toBe('strength')
  })

  it('goes on to Strength once nobody is below the teacher in Combat', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const soldiers = soldiersOf(world, city)
    for (const r of soldiers) {
      r.skills.combat = 3
      r.stats.strength = { base: 10, trained: 0 }
    }
    soldiers[3]!.stats.strength = { base: 14, trained: 0 }
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([soldiers[3]!.id])
    expect(world.cityPlans[city.id]!.jobs[soldiers[3]!.id]!.subject).toBe('strength')
  })

  it('sits empty when nobody could learn anything from the teacher', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    for (const r of soldiersOf(world, city)) {
      r.skills.combat = 3
      r.stats.strength = { base: 10, trained: 0 }
    }
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([])
    expect(jobsOf(world, city, 'train')).toEqual([])
  })

  it('sits empty with no soldier to spare to teach from the hall and gates', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const keep = postsToHold(world, city) + 1
    for (const r of soldiersOf(world, city).slice(keep)) delete r.carried.spear
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([])
    expect(jobsOf(world, city, 'train')).toEqual([])
    expect(jobsOf(world, city, 'soldier')).toHaveLength(keep)
  })

  it('sits empty while a stranger teaches there', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    const ground = withGround(staged)
    const stranger = { ...world.residents[0]!, id: 'stranger', owner: 'r9', cityId: null }
    Object.assign(stranger, { x: ground.x, y: ground.y })
    stranger.order = { kind: 'teach', buildingId: ground.id, subject: 'strength' }
    world.residents.push(stranger)
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([])
  })

  it('never takes those the hall and gates need, however few are left', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const keep = postsToHold(world, city) + 3
    for (const r of soldiersOf(world, city).slice(keep)) delete r.carried.spear
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toHaveLength(1)
    expect(jobsOf(world, city, 'train')).toHaveLength(2)
    expect(jobsOf(world, city, 'soldier')).toHaveLength(postsToHold(world, city))
    expect(npcTrainsItsSoldiers.check(world, terrain)).toEqual([])
  })

  it('trains nobody in a village, even with a ground in its area', () => {
    const terrain = plains(240)
    const staged = bigCity()
    const { world } = staged
    world.residents = []
    const city = foundNpcCity(
      world,
      terrain,
      { ...NPC_VILLAGE, residents: 20 },
      180,
      180,
      mulberry32(3),
    )
    const hall = townHallOf(world, city)!
    const ground: Building = {
      id: newId(world, 'b'),
      kind: 'trainingGround',
      cityId: null,
      x: hall.x + 5,
      y: hall.y + 5,
    }
    world.buildings.push(ground)
    for (const r of world.residents.slice(0, 8)) r.carried.spear = 1
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).toEqual([])
    expect(jobsOf(world, city, 'train')).toEqual([])
  })

  it('goes round them in turns, leaving everyone a turn', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const seen = new Set<string>()
    for (let turn = 0; turn < 8; turn++) {
      world.tick = turn * NPC_TRAIN_TURN_TICKS
      const jobs = {} as Record<string, { kind: 'soldier' }>
      const adults = runResidents(world)
        .get(city.id)!
        .filter((r) => r.carried.spear)
      for (const r of adults) jobs[r.id] = { kind: 'soldier' }
      planTraining(world, city, adults, jobs, terrain.size)
      for (const [id, job] of Object.entries(jobs)) {
        if ((job as { kind: string }).kind === 'train') seen.add(id)
      }
    }
    // All but the teacher, who has as much Combat and the most Strength.
    expect(seen.size).toBe(soldiersOf(world, city).length - 1)
  })
})

describe('soldiers at the training ground (`CONTEXT.md`: Who trains, Alarm)', () => {
  /** Runs the staged city with its ground until those at it have got there and begun. */
  function running(): Staged & { ground: Building; step: (ticks: number) => void; hall: Building } {
    const staged = bigCity()
    const { world, terrain, city } = staged
    const ground = withGround(staged)
    const walking = unhurriedWalking(terrain)
    const step = (ticks: number) => {
      for (let t = 0; t < ticks; t++) stepWorld(world, terrain, walking)
    }
    return { ...staged, ground, step, hall: townHallOf(world, city)! }
  }

  it(
    'walk there, run the Train default and learn, the hall held all the while, their values rising',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, ground, step, hall } = running()
      const soldiers = soldiersOf(world, city)
      const before = new Map(soldiers.map((r) => [r.id, statValue(r, 'strength', world.tick)]))
      const heldNow = () =>
        soldiers.some(
          (r) =>
            !isDown(r) &&
            (isAt(r, hall, terrain.size) ||
              (r.order?.kind === 'walkTo' && isAt(r.order.target, hall, terrain.size))),
        )
      let allThere = false
      let onHall = 0
      for (let t = 0; t < TICKS_PER_GAME_DAY; t++) {
        step(1)
        if (world.cityPlans[city.id]) expect(heldNow()).toBe(true)
        onHall = soldiers.filter((r) => isAt(r, hall, terrain.size)).length
        allThere ||=
          !!teacherAt(ground, world.residents, terrain.size) &&
          traineesOf(ground, world.residents, terrain.size).length > 0
      }
      expect(allThere).toBe(true)
      expect(onHall).toBeGreaterThanOrEqual(NPC_SOLDIERS_ON_HALL)
      const trainees = traineesOf(ground, world.residents, terrain.size)
      expect(trainees.length).toBeGreaterThan(0)
      expect(trainees.every((r) => r.script?.task === 'train' && r.script.scriptId === 0)).toBe(
        true,
      )
      const teacher = teacherAt(ground, world.residents, terrain.size)!
      expect(teacher.order).toMatchObject({ kind: 'teach', subject: 'strength' })
      const rose = trainees.filter(
        (r) => statValue(r, 'strength', world.tick) > (before.get(r.id) ?? Infinity),
      )
      expect(rose.length).toBeGreaterThan(0)
      expect(teacher.stats.strength.trained).toBe(0)
      expect(checkInvariants(world, terrain)).toEqual([])
      // Spread over the ground, not in a heap on one tile.
      expect(new Set(trainees.map((r) => `${r.x},${r.y}`)).size).toBeGreaterThan(1)
    },
  )

  it(
    'wait with no teacher, and leave once the pass finds none',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, ground, step } = running()
      step(TICKS_PER_GAME_DAY / 2)
      const trainees = traineesOf(ground, world.residents, terrain.size)
      expect(trainees.length).toBeGreaterThan(0)
      // No soldiers to spare any more: all but those the hall and gates need are gone.
      const keep = new Set(trainees.slice(0, postsToHold(world, city)).map((r) => r.id))
      for (const r of soldiersOf(world, city)) if (!keep.has(r.id)) delete r.carried.spear
      step(90)
      expect(teacherAt(ground, world.residents, terrain.size)).toBeUndefined()
      expect(traineesOf(ground, world.residents, terrain.size)).toEqual([])
      for (const r of soldiersOf(world, city)) expect(r.script?.task).not.toBe('train')
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )

  it(
    'are taken off by an alarm, and come back to it after',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, ground, step } = running()
      step(TICKS_PER_GAME_DAY / 2)
      const teacher = teacherAt(ground, world.residents, terrain.size)!
      const trainees = traineesOf(ground, world.residents, terrain.size)
      expect(trainees.length).toBeGreaterThan(0)

      // An armed outsider walks up to the ground: they drop what they are at, what it was kept aside.
      const away = { x: 170, y: 170 }
      const outsider = armedOutsider(world, { x: ground.x - 2, y: ground.y }, away)
      const onAlarm = () => [teacher, ...trainees].filter((r) => r.script?.task === 'alarm')
      for (let t = 0; t < 60 && onAlarm().length === 0; t++) step(1)
      const called = onAlarm()
      expect(called.length).toBeGreaterThan(0)
      for (const r of called) expect(r.interrupted).toBeDefined()
      expect(checkInvariants(world, terrain)).toEqual([])

      // The outsider gone, they are back at the ground within a game hour or two of standing down.
      Object.assign(outsider, away)
      for (let t = 0; t < TICKS_PER_GAME_DAY / 2 && onAlarm().length > 0; t++) step(1)
      expect(onAlarm()).toEqual([])
      step(TICKS_PER_GAME_DAY / 4)
      expect(teacherAt(ground, world.residents, terrain.size)).toBeDefined()
      expect(traineesOf(ground, world.residents, terrain.size).length).toBeGreaterThan(0)
      expect(checkInvariants(world, terrain)).toEqual([])
      expect(city.occupation ?? null).toBeNull()
    },
  )

  it(
    'are kept at it by the city’s defence, which clears any other script from its soldiers',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, ground, step } = running()
      step(TICKS_PER_GAME_DAY / 2)
      const trainees = traineesOf(ground, world.residents, terrain.size)
      step(30)
      expect(traineesOf(ground, world.residents, terrain.size).map((r) => r.id)).toEqual(
        trainees.map((r) => r.id),
      )
      for (const r of soldiersOf(world, city)) {
        expect(r.script?.task === undefined || r.script.task === 'train').toBe(true)
      }
    },
  )

  it(
    'leave the ground at the end of their turn for the next lot',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, ground, step } = running()
      step(TICKS_PER_GAME_DAY / 2)
      const first = traineesOf(ground, world.residents, terrain.size).map((r) => r.id)
      expect(first.length).toBeGreaterThan(0)
      const toNext = NPC_TRAIN_TURN_TICKS - (world.tick % NPC_TRAIN_TURN_TICKS)
      step(toNext + TICKS_PER_GAME_DAY / 2)
      const next = traineesOf(ground, world.residents, terrain.size).map((r) => r.id)
      expect(next.length).toBeGreaterThan(0)
      expect(next).not.toEqual(first)
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )
})

describe('the orders behind it (`CONTEXT.md`: Who trains; ADR 0002)', () => {
  /** Who a sender may order to train and teach, standing on the ground. */
  function standing() {
    const staged = bigCity()
    const { world, city } = staged
    const ground = withGround(staged)
    const soldier = soldiersOf(world, city)[0]!
    const unarmed = world.residents.find(
      (r) => r.cityId === city.id && !r.carried.spear && r.bornAt < world.tick - 1e7,
    )!
    for (const r of [soldier, unarmed]) Object.assign(r, { x: ground.x, y: ground.y })
    const sender = npcSender(city)
    return { ...staged, ground, soldier, unarmed, sender }
  }
  const trainOrder = (r: Resident, ground: Building) => ({
    kind: 'train',
    residentId: r.id,
    buildingId: ground.id,
  })
  const teachOrder = (r: Resident, ground: Building) => ({
    kind: 'teach',
    residentId: r.id,
    buildingId: ground.id,
    subject: 'strength',
  })

  it('lets a big city’s soldier train and teach, and nobody else of it', () => {
    const { world, ground, soldier, unarmed, sender } = standing()
    expect(train.validate(world, sender, trainOrder(soldier, ground))).toBeUndefined()
    expect(teach.validate(world, sender, teachOrder(soldier, ground))).toBeUndefined()
    expect(train.validate(world, sender, trainOrder(unarmed, ground))).toBeDefined()
    expect(teach.validate(world, sender, teachOrder(unarmed, ground))).toBeDefined()
  })

  it('refuses the Trade Organization, and a city that has shrunk', () => {
    const { world, city, ground, soldier, sender } = standing()
    city.tradeOrg = 'post'
    expect(train.validate(world, sender, trainOrder(soldier, ground))).toBeDefined()
    expect(teach.validate(world, sender, teachOrder(soldier, ground))).toBeDefined()
    delete city.tradeOrg
    world.residents = world.residents.filter((r, i) => i < 20 || r === soldier)
    expect(train.validate(world, sender, trainOrder(soldier, ground))).toBeDefined()
  })
})

describe('the invariants of the training ground (ADR 0004)', () => {
  it('catches a plan for a second ground, and one of a village', () => {
    const staged = bigCity()
    const { world, terrain, city } = staged
    withGround(staged)
    world.cityPlans[city.id] = {
      plannedAt: world.tick,
      jobs: {},
      project: { kind: 'build', building: 'trainingGround', x: 10, y: 10 },
    }
    expect(npcTrainingGroundsBounded.check(world, terrain)).toHaveLength(1)
    world.buildings = world.buildings.filter((b) => b.kind !== 'trainingGround')
    expect(npcTrainingGroundsBounded.check(world, terrain)).toEqual([])
    world.residents = world.residents.slice(0, 10)
    expect(npcTrainingGroundsBounded.check(world, terrain)).toHaveLength(1)
  })

  it('catches a plan that trains someone unarmed, two teachers, or a hall left bare', () => {
    const { world, terrain, city } = bigCity()
    const [a, b] = soldiersOf(world, city) as [Resident, Resident]
    const unarmed = world.residents.find((r) => r.cityId === city.id && !r.carried.spear)!
    const plan = (jobs: Record<string, { kind: 'teach' | 'train' | 'soldier' }>) => {
      world.cityPlans[city.id] = { plannedAt: world.tick, jobs }
      return npcTrainsItsSoldiers.check(world, terrain)
    }
    const posted = Object.fromEntries(
      soldiersOf(world, city)
        .slice(2, 2 + NPC_SOLDIERS_ON_HALL)
        .map((r) => [r.id, { kind: 'soldier' as const }]),
    )
    expect(plan({ ...posted, [a.id]: { kind: 'teach' }, [b.id]: { kind: 'train' } })).toEqual([])
    expect(
      plan({ ...posted, [a.id]: { kind: 'teach' }, [unarmed.id]: { kind: 'train' } }),
    ).toHaveLength(1)
    expect(plan({ ...posted, [a.id]: { kind: 'teach' }, [b.id]: { kind: 'teach' } })).toHaveLength(
      1,
    )
    expect(plan({ [a.id]: { kind: 'teach' }, [b.id]: { kind: 'train' } })).toHaveLength(1)
  })
})

describe('training and patrols share a city’s soldiers (`CONTEXT.md`: Soldier posts, Who trains)', () => {
  /** One of the city's soldiers put on a round, walking to the first of its stops. */
  function onRound(world: WorldState, city: City, r: Resident): void {
    const plan = (world.cityPlans[city.id] ??= { plannedAt: world.tick, jobs: {} })
    plan.patrols = [{ residentId: r.id, stops: [{ x: r.x + 5, y: r.y }] }]
    r.order = { kind: 'walkTo', target: { x: r.x + 3, y: r.y }, path: null, progress: 0 }
  }

  it('leaves one on a round out of those at hand: no teacher, no trainee', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    const soldiers = soldiersOf(world, city)
    const best = soldiers[5]!
    best.skills.combat = 6
    onRound(world, city, best)
    const adults = runResidents(world).get(city.id)!
    expect(soldiersAtHand(world, city, adults)).not.toContain(best)
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'teach')).not.toContain(best.id)
    expect(jobsOf(world, city, 'train')).not.toContain(best.id)
    expect(world.cityPlans[city.id]!.jobs[best.id]).toEqual({ kind: 'soldier' })
  })

  it('takes one given a job at the ground off their round and their walk', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    const ground = withGround(staged)
    const r = soldiersOf(world, city)[5]!
    onRound(world, city, r)
    const plan = world.cityPlans[city.id]!
    const job = { kind: 'train' as const, groundId: ground.id }
    plan.jobs[r.id] = job
    sharePatrols(world, city, plan, runResidents(world).get(city.id)!, terrain.size, terrain)
    expect(plan.patrols).toBeUndefined()
    steerTraining(world, city, r, job)
    expect(r.order).toBeNull()
  })

  it('moves nobody else off the ground when one goes on a round or comes back', () => {
    const staged = bigCity()
    const { world, city, terrain } = staged
    withGround(staged)
    planCity(world, city, terrain)
    const before = jobsOf(world, city, 'train')
    const offTheGround = soldiersOf(world, city).find(
      (r) => world.cityPlans[city.id]!.jobs[r.id]?.kind === 'soldier',
    )!
    onRound(world, city, offTheGround)
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'train')).toEqual(before)
    delete world.cityPlans[city.id]!.patrols
    offTheGround.order = null
    planCity(world, city, terrain)
    expect(jobsOf(world, city, 'train')).toEqual(before)
  })

  /** Runs a city for `days`, checking both rules as it goes; what it saw, hour by hour. */
  function runBoth(staged: Staged, days: number) {
    const { world, terrain, city } = staged
    const hall = townHallOf(world, city)!
    const walking = unhurriedWalking(terrain)
    const seen = {
      hours: 0,
      trainees: 0,
      rounds: 0,
      leftForWall: 0,
      hoursWithRounds: 0,
      hoursWithBoth: 0,
      mostMovedInATurn: 0,
    }
    let before = { turn: -1, lot: new Set<string>() }
    for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      if (t % 20 === 0) expect(checkInvariants(world, terrain)).toEqual([])
      const plan = world.cityPlans[city.id]
      if (!plan) continue
      const held = soldiersOf(world, city).some(
        (r) =>
          !isDown(r) &&
          (isAt(r, hall, terrain.size) ||
            (r.order?.kind === 'walkTo' && isAt(r.order.target, hall, terrain.size))),
      )
      expect(held).toBe(true)
      // Never on a round and at the ground at once.
      const out = plan.patrols?.map((p) => p.residentId) ?? []
      for (const id of out) expect(plan.jobs[id]?.kind).toBe('soldier')
      if (t % 60 !== 0) continue
      const trainees = jobsOf(world, city, 'train')
      const turn = Math.floor(plan.plannedAt / NPC_TRAIN_TURN_TICKS)
      if (turn === before.turn) {
        const moved = trainees.filter((id) => !before.lot.has(id)).length
        seen.mostMovedInATurn = Math.max(seen.mostMovedInATurn, moved)
      }
      before = { turn, lot: new Set(trainees) }
      seen.leftForWall +=
        jobsOf(world, city, 'soldier').length - out.length - postsToHold(world, city)
      seen.hours++
      seen.trainees += trainees.length
      seen.rounds += out.length
      if (out.length > 0) seen.hoursWithRounds++
      if (out.length > 0 && trainees.length > 0) seen.hoursWithBoth++
    }
    return seen
  }

  it(
    'a city of 110 does both at once, with invariants checked and the hall held',
    { tags: ['slow'], timeout: 900_000 },
    () => {
      const staged = bigCity()
      withGround(staged)
      const seen = runBoth(staged, 12)
      console.log(`Training and patrols, city of 110: ${JSON.stringify(seen)}`)
      expect(seen.hoursWithBoth).toBeGreaterThan(0)
      // A lot stays a lot: someone back from a round takes a place, but it is never reshuffled.
      expect(seen.mostMovedInATurn).toBeLessThanOrEqual(TRAINING_GROUND_MAX_TRAINEES / 2)
    },
  )

  it(
    'a city just big enough keeps its hall and gates, with its wall left to training',
    { tags: ['slow'], timeout: 900_000 },
    () => {
      const staged = bigCity()
      const { world, city } = staged
      withGround(staged)
      // Down to 52 residents, 10 of them soldiers: few past those it must keep.
      for (const r of soldiersOf(world, city).slice(10)) delete r.carried.spear
      const spare = world.residents.filter(
        (r) => r.cityId === city.id && !r.carried.spear && canWork(r, world.tick),
      )
      const gone = new Set(spare.slice(0, world.residents.length - 52).map((r) => r.id))
      world.residents = world.residents.filter((r) => !gone.has(r.id))
      const seen = runBoth(staged, 12)
      console.log(`Training and patrols, city of 52: ${JSON.stringify(seen)}`)
      expect(seen.trainees).toBeGreaterThan(0)
    },
  )
})
