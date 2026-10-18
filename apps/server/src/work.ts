import {
  MAX_WORKERS,
  buildingAt,
  canWork,
  farmOutput,
  farmingLearned,
  unitsThatFit,
  workProblem,
  workersOf,
  type Building,
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
 * finished workplace on the tile they stand on, for now a farm, until given another order.
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
 * Resolves work actions (ADR 0002), one after another (`CONTEXT.md`: Workplace, Farm). A resident
 * who has left the tile, whose workplace is gone or not finished, or who would be one worker too
 * many stops. Otherwise their work adds to their share of the next unit of Food (from Strength and
 * Farming skill) and teaches Farming. Each whole unit goes to the farm's worker carrying the least
 * food who still has room for it; when nobody has, it is left in the pile on the farm's tile.
 */
export function resolveWork(world: WorldState, actions: WorkAction[]): void {
  const workers = new Map<string, number>()
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'workAt') continue
    const farm = world.buildings.find((b) => b.id === o.buildingId)
    const count = workers.get(o.buildingId) ?? 0
    const max = farm ? (MAX_WORKERS[farm.kind] ?? 0) : 0
    const onIt = farm && !farm.site && farm.x === r.x && farm.y === r.y
    if (!farm || !onIt || r.x !== o.at.x || r.y !== o.at.y || count >= max) {
      r.order = null
      continue
    }
    workers.set(o.buildingId, count + 1)
    o.progress += farmOutput(r, world.tick)
    r.skills.farming = (r.skills.farming ?? 0) + farmingLearned(r, world.tick)
    while (o.progress >= 1) {
      o.progress -= 1
      harvest(world, farm)
    }
  }
}

/** One unit of Food from a farm: into the hands of a worker with room, else on the ground. */
function harvest(world: WorldState, farm: Building): void {
  const taker = workersOf(world, farm)
    .filter((w) => unitsThatFit(w, 'food', world.tick) >= 1)
    .sort((a, b) => (a.carried.food ?? 0) - (b.carried.food ?? 0))[0]
  if (taker) taker.carried.food = (taker.carried.food ?? 0) + 1
  else dropGoods(world, farm.x, farm.y, { food: 1 })
}
