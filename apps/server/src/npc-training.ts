import {
  BUILD_MATERIALS,
  FOOTPRINT,
  NPC_SOLDIERS_ON_HALL,
  NPC_TRAIN_TURN_TICKS,
  TRAINING_GROUND_MAX_TRAINEES,
  buildingAt,
  footprintTiles,
  inCityArea,
  isArmed,
  isAt,
  isBigNpcCity,
  subjectValue,
  teacherAt,
  traineesOf,
  trainingGain,
  type Building,
  type City,
  type CityJob,
  type Resident,
  type TrainingSubject,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { stopWork, walkTo } from './npc-behaviour.js'
import { shortGoods } from './npc-chain.js'
import { holdsAboveReserve } from './npc-inner-wall.js'
import { postsToHold, soldiersAtHand, standsPosts } from './npc-posts.js'
import { npcSender } from './order-sender.js'
import { hash } from './residents.js'
import { teach } from './teaching.js'

/*
 * A big NPC city's training ground and who trains there (`CONTEXT.md`: Bigger projects, Who trains;
 * ADR 0029). Nothing about it is stored but the jobs of its plan: its ground is the one in its area,
 * and whose turn it is follows from the tick and their ids.
 */

/** Less than this is no gain: what is left of a ceiling by rounding. */
const NO_GAIN = 1e-9

/**
 * A city's training ground, finished or begun: the one in its area. Like a workplace it has no owner
 * (`CONTEXT.md`: Training ground), so its place is all that makes it the city's.
 */
export function cityGround(world: WorldState, city: City, size: number): Building | undefined {
  return world.buildings.find(
    (b) => b.kind === 'trainingGround' && inCityArea(world, city, b.x, b.y, size),
  )
}

/**
 * Whether a city wants to lay out its training ground (`CONTEXT.md`: Bigger projects): it is a big NPC
 * city with none, nothing is short of its reserve, and it holds the materials above that reserve.
 */
export function wantsTrainingGround(world: WorldState, city: City, size: number): boolean {
  if (city.tradeOrg || !isBigNpcCity(world, city)) return false
  if (cityGround(world, city, size) || shortGoods(world, city).length > 0) return false
  return holdsAboveReserve(world, city, BUILD_MATERIALS.trainingGround ?? {})
}

/** Who teaches of those at hand: the most Combat, among equals the most Strength, then by id. */
function pickTeacher(soldiers: readonly Resident[], tick: number): Resident | undefined {
  return [...soldiers].sort(
    (a, b) =>
      subjectValue(b, 'combat', tick) - subjectValue(a, 'combat', tick) ||
      subjectValue(b, 'strength', tick) - subjectValue(a, 'strength', tick) ||
      (a.id < b.id ? -1 : 1),
  )[0]
}

/**
 * What a ground teaches now, and who can learn it (`CONTEXT.md`: Who trains): Combat while any of them
 * is still below the teacher in it, else Strength. Nothing when nobody can learn either.
 */
function lessonOf(
  teacher: Resident,
  others: readonly Resident[],
  tick: number,
): { subject: TrainingSubject; learners: Resident[] } | undefined {
  for (const subject of ['combat', 'strength'] as const) {
    const learners = others.filter((r) => trainingGain(r, teacher, subject, tick) > NO_GAIN)
    if (learners.length > 0) return { subject, learners }
  }
  return undefined
}

/** Whose turn it is: `places` of `learners`, going round them by id, a new lot each turn. */
function theirTurn(learners: readonly Resident[], places: number, tick: number): Resident[] {
  const inOrder = [...learners].sort((a, b) => (a.id < b.id ? -1 : 1))
  const turn = Math.floor(tick / NPC_TRAIN_TURN_TICKS)
  const from = (turn * places) % inOrder.length
  return [...inOrder, ...inOrder].slice(from, from + Math.min(places, inOrder.length))
}

/**
 * Who trains in a big NPC city with a finished training ground, for its planning pass (`CONTEXT.md`:
 * Who trains): of its soldiers at hand, once enough are left to hold the posts on its hall and gates
 * (`postsToHold`), the one with the most Combat teaches and others train, as many as those left over
 * and the room at the ground allow. With none to spare for both, or nothing anyone could learn, the
 * ground sits empty; so it does while someone not of the city teaches there. `jobs` holds the jobs the
 * pass has given so far: only those it has as soldiers are moved.
 */
export function planTraining(
  world: WorldState,
  city: City,
  adults: readonly Resident[],
  jobs: Record<string, CityJob>,
  size: number,
): void {
  if (city.tradeOrg || !isBigNpcCity(world, city) || !standsPosts(world, city)) return
  const ground = cityGround(world, city, size)
  if (!ground || ground.site) return
  const ours = (r: Resident) => r.owner === null && r.cityId === city.id
  const there = teacherAt(ground, world.residents, size)
  if (there && !ours(there)) return
  const atHand = soldiersAtHand(world, city, adults).filter((r) => jobs[r.id]?.kind === 'soldier')
  const toSpare = atHand.length - postsToHold(world, city)
  const room =
    TRAINING_GROUND_MAX_TRAINEES -
    traineesOf(ground, world.residents, size).filter((r) => !ours(r)).length
  const places = Math.min(toSpare - 1, room)
  if (places < 1) return
  const teacher = pickTeacher(atHand, world.tick)
  if (!teacher) return
  const lesson = lessonOf(
    teacher,
    atHand.filter((r) => r !== teacher),
    world.tick,
  )
  if (!lesson) return
  jobs[teacher.id] = { kind: 'teach', groundId: ground.id, subject: lesson.subject }
  for (const r of theirTurn(lesson.learners, places, world.tick)) {
    jobs[r.id] = { kind: 'train', groundId: ground.id }
  }
}

/**
 * What a pass just now changed for one who trains or teaches, or is to (`CONTEXT.md`: Who trains): off
 * the ground's turn, they stop; a teacher goes on to the subject it has them teach; and one walking
 * anywhere else turns for the ground, a load to put away first (`stowing`).
 */
export function steerTraining(world: WorldState, city: City, r: Resident, job?: CityJob): void {
  const groundId = job?.kind === 'train' || job?.kind === 'teach' ? job.groundId : undefined
  const o = r.order
  if (
    r.script?.task === 'train' &&
    (job?.kind !== 'train' || r.script.memory.groundId !== groundId)
  ) {
    stopWork(r)
  } else if (o?.kind === 'train' && (job?.kind !== 'train' || o.buildingId !== groundId)) {
    stopWork(r)
  } else if (o?.kind === 'teach') {
    if (job?.kind !== 'teach' || o.buildingId !== groundId) stopWork(r)
    else if (job.subject && o.subject !== job.subject)
      giveTeach(world, city, r, o.buildingId, job.subject)
  } else if (groundId !== undefined && o?.kind === 'walkTo' && !r.script) {
    const at = buildingAt(world, o.target.x, o.target.y)
    if (at?.id !== groundId) r.order = null
  }
}

/** The teach order, as a Player's resident standing there would be given it (ADR 0002). */
function giveTeach(
  world: WorldState,
  city: City,
  r: Resident,
  buildingId: string,
  subject: TrainingSubject,
): void {
  const sender = npcSender(city)
  const request = { kind: 'teach', residentId: r.id, buildingId, subject }
  if (teach.validate(world, sender, request) === undefined) teach.apply(world, sender, request)
}

/**
 * Sends one with a job at its training ground there and starts them: a teacher stands in its middle
 * and teaches, a trainee stands on the tile their id gives them, so they spread over it, and runs the
 * game's Train default (ADR 0002; `CONTEXT.md`: Trainee). In the city's area they set off only when its
 * pass just ran (`passed`), as for a post. Whether this was their job.
 */
export function goTrain(
  world: WorldState,
  city: City,
  r: Resident,
  job: CityJob | undefined,
  passed: boolean,
  size: number,
): boolean {
  if (job?.kind !== 'train' && job?.kind !== 'teach') return false
  const ground = world.buildings.find((b) => b.id === job.groundId)
  if (!ground || ground.site) return false
  if (!isAt(r, ground, size)) {
    if (!passed && inCityArea(world, city, r.x, r.y, size)) return true
    const tiles = footprintTiles(ground, size)
    const middle = Math.floor(FOOTPRINT.trainingGround / 2)
    const [x, y] =
      job.kind === 'teach'
        ? tiles[middle * FOOTPRINT.trainingGround + middle]!
        : tiles[hash(r.id) % tiles.length]!
    walkTo(r, { x, y })
    return true
  }
  if (job.kind === 'train') {
    r.script = { scriptId: 0, task: 'train', memory: { groundId: ground.id } }
  } else if (job.subject) giveTeach(world, city, r, ground.id, job.subject)
  return true
}

/**
 * A big NPC city builds one training ground and a smaller city none (`CONTEXT.md`: Bigger projects;
 * ADR 0004): a plan made this tick lays none out where one stands or is begun in its area, nor at a
 * city that isn't big or is the Trade Organization's.
 */
export const npcTrainingGroundsBounded: Invariant = {
  name: 'npc-training-grounds-bounded',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const project = plan.project
      if (plan.plannedAt !== world.tick || project?.kind !== 'build') continue
      if (project.building !== 'trainingGround') continue
      if (buildingAt(world, project.x, project.y)) continue
      const city = world.cities.find((c) => c.id === cityId)
      if (!city) continue
      const problem =
        city.tradeOrg || !isBigNpcCity(world, city)
          ? 'is not a big NPC city'
          : cityGround(world, city, terrain.size)
            ? 'already has one'
            : undefined
      if (!problem) continue
      out.push({
        invariant: this.name,
        message: `${cityId} plans a training ground and ${problem}`,
        entityIds: [cityId],
      })
    }
    return out
  },
}

/**
 * Those an NPC city's plan has at a training ground are its soldiers and leave its hall held
 * (`CONTEXT.md`: Who trains; ADR 0004). In a plan made this tick: the Trade Organization has nobody at
 * one, a ground has one teacher and room for its trainees, each of them is armed, and at least the
 * hall's soldiers are left standing posts.
 */
export const npcTrainsItsSoldiers: Invariant = {
  name: 'npc-trains-its-soldiers',
  check(world) {
    const out: InvariantViolation[] = []
    const residents = new Map(world.residents.map((r) => [r.id, r]))
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      if (plan.plannedAt !== world.tick) continue
      const jobs = Object.entries(plan.jobs)
      const teachers = jobs.filter(([, j]) => j.kind === 'teach')
      const trainees = jobs.filter(([, j]) => j.kind === 'train')
      const there = [...teachers, ...trainees]
      if (there.length === 0) continue
      const report = (message: string, ids: string[]) =>
        out.push({
          invariant: this.name,
          message: `${cityId} ${message}`,
          entityIds: [cityId, ...ids],
        })
      const names = there.map(([id]) => id)
      if (world.cities.find((c) => c.id === cityId)?.tradeOrg) {
        report('is the Trade Organization’s, and trains', names)
      }
      if (teachers.length !== 1) report(`plans ${teachers.length} teachers`, names)
      if (trainees.length > TRAINING_GROUND_MAX_TRAINEES) {
        report(`plans ${trainees.length} trainees`, names)
      }
      for (const [id] of there) {
        const r = residents.get(id)
        if (r && !isArmed(r)) report(`trains ${id}, who is no soldier`, [id])
      }
      const onPosts = jobs.filter(([, j]) => j.kind === 'soldier').length
      if (onPosts < NPC_SOLDIERS_ON_HALL) {
        report(`leaves ${onPosts} soldiers for its posts while training`, names)
      }
    }
    return out
  },
}
