import {
  MAX_WORKERS,
  RECIPES,
  WORKPLACE_SKILL,
  batchWork,
  buildingAt,
  canWork,
  hasInput,
  pileAt,
  workLearned,
  workOutput,
  workProblem,
  workersOf,
  workplaceGood,
  type Building,
  type Good,
  type OrderRequest,
  type Resident,
  type Stock,
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
 * finished workplace on the tile they stand on (a farm, lumber camp, quarry, mine, smelter or
 * mint) until given another order.
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
 * Strength and the workplace's skill) and teaches that skill. Each whole unit goes on the pile on
 * the workplace's tile. At a smelter or mint (`CONTEXT.md`: Smelter) the work goes into the next
 * batch of its recipe, and only while the input for it is there (`inputAt`); a finished batch uses
 * that input up and leaves its output on the pile the same way.
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
    const recipe = RECIPES[place.kind]
    if (recipe) {
      // A smelter or mint without the input for a batch stands idle: no work, nothing learned.
      if (!hasInput(world, place)) continue
      o.progress += batchWork(r, place.kind, world.tick)
    } else {
      o.progress += workOutput(r, good, skill, world.tick)
    }
    r.skills[skill] = (r.skills[skill] ?? 0) + workLearned(r, world.tick)
    while (o.progress >= 1) {
      if (recipe && !hasInput(world, place)) {
        o.progress = Math.min(o.progress, 1 - 1e-9)
        break
      }
      o.progress -= 1
      if (recipe) {
        useUp(world, place, recipe.input)
        for (const [made, units] of Object.entries(recipe.output) as [Good, number][]) {
          for (let i = 0; i < units; i++) produce(world, place, made)
        }
      } else produce(world, place, good)
    }
  }
}

/**
 * Takes a batch's input from what a smelter's or mint's workers carry, the most laden first, and
 * then from the pile on its tile (`inputAt`). The caller has checked it is all there.
 */
function useUp(world: WorldState, place: Building, input: Stock): void {
  for (const [good, units] of Object.entries(input) as [Good, number][]) {
    let left = units
    const carriers = workersOf(world, place).sort(
      (a, b) => (b.carried[good] ?? 0) - (a.carried[good] ?? 0),
    )
    const pile = pileAt(world, place.x, place.y)
    for (const stock of [...carriers.map((w) => w.carried), ...(pile ? [pile.goods] : [])]) {
      const take = Math.min(left, stock[good] ?? 0)
      if (take <= 0) continue
      if ((stock[good] ?? 0) > take) stock[good] = (stock[good] ?? 0) - take
      else delete stock[good]
      left -= take
    }
  }
  world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
}

/** One unit of a workplace's good, left on the pile on its tile (`CONTEXT.md`: Workplace). */
function produce(world: WorldState, place: Building, good: Good): void {
  dropGoods(world, place.x, place.y, { [good]: 1 })
}
