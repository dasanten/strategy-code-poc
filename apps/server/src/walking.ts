import {
  isPassableTerrain,
  terrainAt,
  walkSpeed,
  wrapDelta,
  type OrderRequest,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { OrderKind, OrderSender } from './orders.js'
import { PathFinder } from './pathfinding.js'
import { realmOf } from './starting-city.js'

/** Time the pathfinder may use per tick (ADR 0004: ticks stay well under their 1 s budget). */
export const PATH_BUDGET_MS = 50

/** An action a resident requests; the world checks and resolves it at the end of the tick. */
export interface StepAction {
  kind: 'step'
  residentId: string
  to: { x: number; y: number }
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

/**
 * Turns residents' walk orders into step actions each tick, and resolves the steps. The path for
 * a new order is found a little at a time (`PathFinder`); the found path is kept in the order as
 * plain data, so a restart loses nothing but searches in progress, which start again.
 */
export class Walking {
  private finder: PathFinder
  private searching = new Map<string, string>()

  constructor(private terrain: TerrainMap) {
    this.finder = new PathFinder(terrain)
  }

  /** Requests this tick's steps for every walking resident. */
  requestSteps(world: WorldState, budgetMs = PATH_BUDGET_MS): StepAction[] {
    this.plan(world, budgetMs)
    const steps: StepAction[] = []
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'walkTo' || !o.path) continue
      const next = o.path[0]
      if (!next) {
        r.order = null
        continue
      }
      o.progress += walkSpeed(r, terrainAt(this.terrain, next[0], next[1]), world.tick)
      if (o.progress >= 1)
        steps.push({ kind: 'step', residentId: r.id, to: { x: next[0], y: next[1] } })
    }
    return steps
  }

  /** Finds paths for new walk orders; drops orders whose target can't be reached. */
  private plan(world: WorldState, budgetMs: number): void {
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'walkTo' || o.path) continue
      // A new order for a resident replaces any search for their old one.
      const key = `${o.target.x},${o.target.y}`
      if (this.searching.get(r.id) !== key) {
        this.finder.request(r.id, [r.x, r.y], [o.target.x, o.target.y])
        this.searching.set(r.id, key)
      }
    }
    if (this.finder.pending > 0) this.finder.advance(budgetMs)
    for (const [id] of this.searching) {
      const result = this.finder.result(id)
      if (!result || result.status === 'searching') continue
      this.searching.delete(id)
      const r = world.residents.find((x) => x.id === id)
      if (r?.order?.kind !== 'walkTo' || r.order.path) continue
      if (result.status === 'found') r.order.path = result.path.map(([x, y]) => [x, y])
      else r.order = null
    }
  }

  /**
   * Resolves step actions (ADR 0002): a step happens only if the resident still exists, the
   * tile is next to them and can be entered. Each step taken uses up one tile of progress.
   */
  resolve(world: WorldState, steps: StepAction[]): number {
    let taken = 0
    for (const step of steps) {
      const r = world.residents.find((x) => x.id === step.residentId)
      if (!r) continue
      const size = this.terrain.size
      const near =
        Math.abs(wrapDelta(r.x, step.to.x, size)) + Math.abs(wrapDelta(r.y, step.to.y, size)) === 1
      if (!near || !isPassableTerrain(terrainAt(this.terrain, step.to.x, step.to.y))) {
        r.order = null
        continue
      }
      r.x = step.to.x
      r.y = step.to.y
      taken++
      const o = r.order
      if (o?.kind !== 'walkTo' || !o.path) continue
      o.path.shift()
      o.progress -= 1
      if (o.path.length === 0) r.order = null
    }
    return taken
  }
}
