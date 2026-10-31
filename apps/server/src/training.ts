import {
  MAP_SIZE,
  SKILL_MAX,
  TRAINING_GROUND_MAX_TRAINEES,
  buildingAt,
  isAt,
  teacherAt,
  traineesOf,
  trainedCap,
  trainingGain,
  trainProblem,
  type Building,
  type OrderRequest,
  type Resident,
  type SkillName,
  type StatName,
  type TrainingSubject,
  type WorldState,
} from '@csp/shared'
import { orderedResident } from './order-sender.js'
import type { OrderKind } from './orders.js'

/** The input of a train order: which resident trains at the training ground they stand on. */
interface TrainRequest extends OrderRequest {
  kind: 'train'
  residentId: string
  buildingId: string
}

/**
 * The train order (`CONTEXT.md`: Trainee): a grown resident of the Player's realm trains at the
 * finished training ground they stand on, until they walk off or take another order. A ground
 * has room for `TRAINING_GROUND_MAX_TRAINEES`. NPC cities train nobody (`CONTEXT.md`: Who
 * trains).
 */
export const train: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<TrainRequest>
    if (sender.npcCityId !== undefined) return 'NPC cities don’t train'
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    const problem = trainProblem(world, r)
    if (problem) return problem
    const here = buildingAt(world, r.x, r.y)
    if (o.buildingId !== here?.id) return 'stand on the training ground to train there'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, buildingId } = order as TrainRequest
    const r = world.residents.find((x) => x.id === residentId)
    const ground = world.buildings.find((b) => b.id === buildingId)
    if (!r || !ground || !isAt(r, ground)) return
    // Train orders for a full ground in one tick: the first applied train, the others fail.
    if (traineesOf(ground, world.residents).length >= TRAINING_GROUND_MAX_TRAINEES) return
    r.order = { kind: 'train', buildingId, learning: lesson(world, r, ground).subject }
  },
}

/**
 * What a trainee at `ground` would learn this tick: the subject its teacher teaches and their
 * gain in it (`trainingGain`); no subject while there is no teacher or they are at the ceiling.
 */
function lesson(
  world: WorldState,
  r: Resident,
  ground: Building,
  size = MAP_SIZE,
): { subject: TrainingSubject | null; gain: number } {
  const teacher = teacherAt(ground, world.residents, size)
  const o = teacher?.order
  if (!teacher || o?.kind !== 'teach') return { subject: null, gain: 0 }
  const gain = trainingGain(r, teacher, o.subject, world.tick)
  return { subject: gain > 0 ? o.subject : null, gain }
}

/**
 * Training, each tick (`CONTEXT.md`: Trainee, Training). A trainee who has left the ground's
 * footprint, whose ground is gone, or who is one trainee too many there stops. The others gain
 * in the subject the ground's teacher teaches (`trainingGain`): a stat in its trained bonus, a
 * skill in the skill. Without a teacher, or at their ceiling, they wait. The teacher gains
 * nothing. Runs after `stepTeaching`, so only a teacher who still holds teaches.
 */
export function stepTraining(world: WorldState, size: number): void {
  const trainees = new Map<string, number>()
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'train') continue
    const ground = world.buildings.find((b) => b.id === o.buildingId)
    const count = trainees.get(o.buildingId) ?? 0
    const holds =
      ground?.kind === 'trainingGround' &&
      !ground.site &&
      isAt(r, ground, size) &&
      count < TRAINING_GROUND_MAX_TRAINEES
    if (!holds) {
      r.order = null
      continue
    }
    trainees.set(o.buildingId, count + 1)
    const { subject, gain } = lesson(world, r, ground, size)
    if (subject) learn(r, subject, gain)
    o.learning = subject
  }
}

/** Adds `gain` to a trainee's stat's trained bonus or skill, within its cap or maximum. */
function learn(r: Resident, subject: TrainingSubject, gain: number): void {
  if (subject in r.stats) {
    const stat = r.stats[subject as StatName]
    stat.trained = Math.min(trainedCap(stat.base), stat.trained + gain)
    return
  }
  const skill = subject as SkillName
  r.skills[skill] = Math.min(SKILL_MAX[skill], (r.skills[skill] ?? 0) + gain)
}
