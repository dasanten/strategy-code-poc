import {
  MAX_WORKERS,
  WORKPLACE_SKILL,
  buildingAt,
  canWork,
  unitsThatFit,
  workLearned,
  workOutput,
  workProblem,
  workersOf,
  workplaceGood,
  type Building,
  type Good,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'
import { dropGoods } from './survival.js'

/**
 * An action a resident with a work-at order requests: put a tick's work into the workplace on
 * their tile. The world checks and resolves it at the end of the tick.
 */
export interface WorkAction {
  residentId: string
}

/** The input of a work-at order: which resident works the workplace on the tile they stand on. */
interface WorkRequest extends OrderRequest {
  kind: 'workAt'
  residentId: string
}

/**
 * The work-at order (`CONTEXT.md`: Workplace): one of the Player's adult residents works the
 * finished workplace on the tile they stand on (a farm, lumber camp, quarry or mine) until given
 * another order.
 */
export const workAt: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<WorkRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t work'
    return workProblem(world, r)
  },
  apply(world, _sender, order) {
    const { residentId } = order as WorkRequest
    const r = world.residents.find((x) => x.id === residentId)
    const here = r && buildingAt(world, r.x, r.y)
    if (r && here) startWork(r, here)
  },
}

/** Sets a resident to work the workplace on their tile. */
export function startWork(r: Resident, workplace: Building): void {
  r.order = { kind: 'workAt', buildingId: workplace.id, at: { x: r.x, y: r.y }, progress: 0 }
}

/** Requests this tick's work actions from residents' work-at orders. */
export function requestWork(world: WorldState): WorkAction[] {
  return world.residents
    .filter((r) => r.order?.kind === 'workAt')
    .map((r) => ({ residentId: r.id }))
}

/**
 * Resolves work actions (ADR 0002), one after another (`CONTEXT.md`: Workplace). A resident who
 * has left the tile, whose workplace is gone or not finished, or who would be one worker too many
 * stops. Otherwise their work adds to their share of the next unit of the workplace's good (from
 * Strength and the workplace's skill) and teaches that skill. Each whole unit goes to the
 * workplace's worker carrying the least of that good who still has room for it; when nobody has,
 * it is left in the pile on the workplace's tile.
 */
export function resolveWork(world: WorldState, actions: WorkAction[]): void {
  const workers = new Map<string, number>()
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'workAt') continue
    const place = world.buildings.find((b) => b.id === o.buildingId)
    const count = workers.get(o.buildingId) ?? 0
    const max = place ? (MAX_WORKERS[place.kind] ?? 0) : 0
    const good = place && workplaceGood(world, place)
    const skill = place && WORKPLACE_SKILL[place.kind]
    const onIt = place && !place.site && place.x === r.x && place.y === r.y
    if (!place || !onIt || !good || !skill || r.x !== o.at.x || r.y !== o.at.y || count >= max) {
      r.order = null
      continue
    }
    workers.set(o.buildingId, count + 1)
    o.progress += workOutput(r, good, skill, world.tick)
    r.skills[skill] = (r.skills[skill] ?? 0) + workLearned(r, world.tick)
    while (o.progress >= 1) {
      o.progress -= 1
      produce(world, place, good)
    }
  }
}

/** One unit of a workplace's good: into the hands of a worker with room, else on the ground. */
function produce(world: WorldState, place: Building, good: Good): void {
  const taker = workersOf(world, place)
    .filter((w) => unitsThatFit(w, good, world.tick) >= 1)
    .sort((a, b) => (a.carried[good] ?? 0) - (b.carried[good] ?? 0))[0]
  if (taker) taker.carried[good] = (taker.carried[good] ?? 0) + 1
  else dropGoods(world, place.x, place.y, { [good]: 1 })
}
