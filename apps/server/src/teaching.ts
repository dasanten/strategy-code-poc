import {
  buildingAt,
  isAt,
  teacherAt,
  teachProblem,
  type OrderRequest,
  type TrainingSubject,
  type WorldState,
} from '@csp/shared'
import { orderedResident } from './order-sender.js'
import type { OrderKind } from './orders.js'

/**
 * The input of a teach order: which resident teaches what at the training ground they stand on.
 */
interface TeachRequest extends OrderRequest {
  kind: 'teach'
  residentId: string
  buildingId: string
  subject: TrainingSubject
}

/**
 * The teach order (`CONTEXT.md`: Teacher): a grown resident of the Player's realm teaches a stat
 * or a skill at the finished training ground they stand on, until they walk off or take another
 * order. A ground has one teacher at a time. NPC cities train nobody (`CONTEXT.md`: Who trains).
 */
export const teach: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<TeachRequest>
    if (sender.npcCityId !== undefined) return 'NPC cities don’t train'
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    const problem = teachProblem(world, r, o.subject)
    if (problem) return problem
    const here = buildingAt(world, r.x, r.y)
    if (o.buildingId !== here?.id) return 'stand on the training ground to teach there'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, buildingId, subject } = order as TeachRequest
    const r = world.residents.find((x) => x.id === residentId)
    const ground = world.buildings.find((b) => b.id === buildingId)
    if (!r || !ground || !isAt(r, ground)) return
    // Two teach orders for one ground in a tick: the first applied teaches, the other fails.
    const teacher = teacherAt(ground, world.residents)
    if (teacher && teacher !== r) return
    r.order = { kind: 'teach', buildingId, subject }
  },
}

/**
 * Ends the teaching that no longer holds (`CONTEXT.md`: Teacher): a teacher who has left the
 * ground's footprint, whose ground is gone, or who is one teacher too many there stops. Teaching
 * itself puts nothing into the world; trainees learn from it (Train).
 */
export function stepTeaching(world: WorldState, size: number): void {
  const taught = new Set<string>()
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'teach') continue
    const ground = world.buildings.find((b) => b.id === o.buildingId)
    const holds =
      ground?.kind === 'trainingGround' &&
      !ground.site &&
      isAt(r, ground, size) &&
      !taught.has(ground.id)
    if (!holds) {
      r.order = null
      continue
    }
    taught.add(ground.id)
  }
}
