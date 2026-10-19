import {
  carriageCanEnter,
  driveSpeed,
  drivingLearned,
  horseFor,
  isPassableTerrain,
  terrainAt,
  walkSpeed,
  wrapDelta,
  type DriveOrder,
  type HaulOrder,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WalkOrder,
  type WorldState,
} from '@csp/shared'
import type { OrderKind, OrderSender } from './orders.js'
import { CARRIAGE_COSTS, PathFinder, WALKING_COSTS } from './pathfinding.js'
import { realmOf } from './starting-city.js'

/** Time the pathfinder may use per tick (ADR 0004: ticks stay well under their 1 s budget). */
export const PATH_BUDGET_MS = 50

/**
 * An action a resident requests: step onto the next tile, on foot or, with `carriageId`, driving
 * that carriage there. The world checks and resolves it at the end of the tick.
 */
export interface StepAction {
  kind: 'step'
  residentId: string
  to: { x: number; y: number }
  carriageId?: string
}

/** The input of a walk-to order: which resident, and the tile to go to. */
interface WalkToRequest extends OrderRequest {
  kind: 'walkTo'
  residentId: string
  x: number
  y: number
}

/**
 * The walk-to order (`CONTEXT.md`: Order): one of the Player's residents walks to a tile. It
 * only sets the resident's order; the path is found and the steps are taken in later ticks.
 */
export const walkTo: OrderKind = {
  validate(world, sender: OrderSender, order: OrderRequest) {
    const o = order as Partial<WalkToRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) return 'the target must be a tile'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, x, y } = order as WalkToRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'walkTo', target: { x, y }, path: null, progress: 0 }
  },
}

/** A walk-to or drive order, or a haul route driving to its next stop: all go along a path. */
type MoveOrder = WalkOrder | DriveOrder | HaulOrder

function moveOrder(r: Resident): MoveOrder | undefined {
  const o = r.order
  if (o?.kind === 'haul') return o.phase === 'driving' ? o : undefined
  return o?.kind === 'walkTo' || o?.kind === 'drive' ? o : undefined
}

/** Where a moving order goes: its target, or a haul route's next stop. */
function targetOf(o: MoveOrder): { x: number; y: number } {
  return o.kind === 'haul' ? o[o.stop] : o.target
}

/** The search for a moving order's path, by kind and target. */
function searchKey(o: MoveOrder): string {
  const { x, y } = targetOf(o)
  return `${o.kind}:${x},${y}`
}

/** A moving order got there: a walk or drive is done, a haul route starts on its stop. */
function arrive(r: Resident, o: MoveOrder): void {
  if (o.kind !== 'haul') {
    r.order = null
    return
  }
  o.phase = 'loading'
  o.path = null
  o.progress = 0
}

/**
 * Turns residents' walk and drive orders into step actions each tick, and resolves the steps. The
 * path for a new order is found a little at a time (`PathFinder`), with the carriage's costs for
 * a drive; the found path is kept in the order as plain data, so a restart loses nothing but
 * searches in progress, which start again.
 */
export class Walking {
  private finder: PathFinder
  private searching = new Map<string, string>()

  constructor(private terrain: TerrainMap) {
    this.finder = new PathFinder(terrain)
  }

  /**
   * Requests this tick's steps for every walking resident and every driver. A driver goes at
   * their carriage's speed and learns Driving while they drive.
   */
  requestSteps(world: WorldState, budgetMs = PATH_BUDGET_MS): StepAction[] {
    this.plan(world, budgetMs)
    const steps: StepAction[] = []
    for (const r of world.residents) {
      const o = moveOrder(r)
      if (!o?.path) continue
      const next = o.path[0]
      if (!next) {
        arrive(r, o)
        continue
      }
      const ground = terrainAt(this.terrain, next[0], next[1])
      if (o.kind !== 'walkTo') {
        o.progress += driveSpeed(r, ground)
        r.skills.driving = (r.skills.driving ?? 0) + drivingLearned(r, world.tick)
      } else {
        o.progress += walkSpeed(r, ground, world.tick)
      }
      if (o.progress < 1) continue
      const to = { x: next[0], y: next[1] }
      const carriageId = o.kind === 'walkTo' ? undefined : o.carriageId
      steps.push({ kind: 'step', residentId: r.id, to, ...(carriageId ? { carriageId } : {}) })
    }
    return steps
  }

  /**
   * Finds paths for new walk and drive orders and haul routes' next legs; drops orders whose
   * target can't be reached.
   */
  private plan(world: WorldState, budgetMs: number): void {
    for (const r of world.residents) {
      const o = moveOrder(r)
      if (!o || o.path) continue
      // A new order for a resident replaces any search for their old one.
      const key = searchKey(o)
      if (this.searching.get(r.id) !== key) {
        const costs = o.kind === 'walkTo' ? WALKING_COSTS : CARRIAGE_COSTS
        const target = targetOf(o)
        this.finder.request(r.id, [r.x, r.y], [target.x, target.y], costs)
        this.searching.set(r.id, key)
      }
    }
    if (this.finder.pending > 0) this.finder.advance(budgetMs)
    for (const [id, key] of this.searching) {
      const result = this.finder.result(id)
      if (!result || result.status === 'searching') continue
      this.searching.delete(id)
      const r = world.residents.find((x) => x.id === id)
      const o = r && moveOrder(r)
      if (!o || o.path || searchKey(o) !== key) continue
      if (result.status === 'found') o.path = result.path.map(([x, y]) => [x, y])
      else r.order = null
    }
  }

  /**
   * Resolves step actions (ADR 0002): a step happens only if the resident still exists, the
   * tile is next to them and can be entered. A driver's step also needs their carriage on their
   * tile with a horse to pull it, and a tile a carriage can enter; the carriage and its horse,
   * hitched now if it wasn't, go along. Each step taken uses up one tile of progress.
   */
  resolve(world: WorldState, steps: StepAction[]): number {
    let taken = 0
    for (const step of steps) {
      const r = world.residents.find((x) => x.id === step.residentId)
      if (!r) continue
      const size = this.terrain.size
      const near =
        Math.abs(wrapDelta(r.x, step.to.x, size)) + Math.abs(wrapDelta(r.y, step.to.y, size)) === 1
      const ground = terrainAt(this.terrain, step.to.x, step.to.y)
      if (!near || !isPassableTerrain(ground)) {
        r.order = null
        continue
      }
      if (step.carriageId) {
        const carriage = world.carriages.find((k) => k.id === step.carriageId)
        const horse = carriage && horseFor(world, carriage)
        const together =
          carriage?.x === r.x && carriage.y === r.y && horse?.x === r.x && horse.y === r.y
        if (!carriage || !horse || !together || !carriageCanEnter(ground)) {
          r.order = null
          continue
        }
        carriage.horseId = horse.id
        carriage.x = horse.x = step.to.x
        carriage.y = horse.y = step.to.y
      }
      r.x = step.to.x
      r.y = step.to.y
      taken++
      const o = moveOrder(r)
      if (!o?.path) continue
      o.path.shift()
      o.progress -= 1
      if (o.path.length === 0) arrive(r, o)
    }
    return taken
  }
}
