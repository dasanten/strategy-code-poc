import {
  armyDrivenTo,
  armySpot,
  inContact,
  carriageCanEnter,
  driveSpeed,
  drivingLearned,
  groundAt,
  horseFor,
  isPassableTerrain,
  mayStep,
  wallSide,
  strandedOnWall,
  tileIndex,
  wallMap,
  wallsKey,
  roadTiles,
  walkSpeed,
  besideStep,
  isLineOrder,
  stepLength,
  type AttackOrder,
  type DriveOrder,
  type HaulOrder,
  type OrderRequest,
  type Resident,
  type LineOrder,
  type StoreOrder,
  type FetchOrder,
  type TerrainMap,
  type WalkOrder,
  type WallMap,
  type WorldState,
} from '@csp/shared'
import { orderedResident } from './order-sender.js'
import type { OrderKind, OrderSender } from './orders.js'
import { CARRIAGE_COSTS, PathFinder, WALKING_COSTS } from './pathfinding.js'
import { waitingForArmy } from './armies.js'
import { waitingForEscort } from './caravans.js'
import { attackTarget } from './combat.js'
import { endOrder, placeOf, placeTile } from './storing.js'

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
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
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
 * A walk-to or drive order, a haul route driving to its next stop, an attack order going after
 * its target, or a road order walking to its next tile: all go along a path.
 */
type MoveOrder =
  WalkOrder | DriveOrder | HaulOrder | AttackOrder | LineOrder | StoreOrder | FetchOrder

function moveOrder(r: Resident): MoveOrder | undefined {
  const o = r.order
  if (o?.kind === 'haul') return o.phase === 'driving' ? o : undefined
  if (isLineOrder(o)) return o.phase === 'walking' ? o : undefined
  if (o?.kind === 'store' || o?.kind === 'fetch') return o.phase === 'walking' ? o : undefined
  return o?.kind === 'walkTo' || o?.kind === 'drive' || o?.kind === 'attack' ? o : undefined
}

/**
 * Where a moving order goes: its target, a haul route's next stop, or the tile an attack order's
 * target (a resident, or a wall or gate) stands on; nowhere when that target is gone.
 */
function targetOf(world: WorldState, o: MoveOrder): { x: number; y: number } | undefined {
  if (o.kind === 'haul') return o[o.stop]
  if (o.kind === 'attack') return attackTarget(world, o.targetId)
  if (isLineOrder(o)) return { x: o.tiles[0]![0], y: o.tiles[0]![1] }
  if (o.kind === 'store' || o.kind === 'fetch') return placeTile(world, placeOf(o))
  return o.target
}

/** The search for a moving order's path, by kind and target. */
function searchKey(world: WorldState, o: MoveOrder): string {
  const to = targetOf(world, o)
  return to ? `${o.kind}:${to.x},${to.y}` : `${o.kind}:gone`
}

/** On foot, rather than driving a carriage. */
function onFoot(
  o: MoveOrder,
): o is WalkOrder | AttackOrder | LineOrder | StoreOrder | FetchOrder {
  return o.kind !== 'drive' && o.kind !== 'haul'
}

/**
 * An attack order that need not walk this tick: its target is gone (the order ends in combat) or
 * in contact (it strikes instead). One whose path no longer ends in contact with its target, as
 * the target moved on, finds a new one.
 */
function attackHolds(world: WorldState, r: Resident, o: AttackOrder, size: number): boolean {
  const target = targetOf(world, o)
  if (!target || inContact(size, r, target)) return true
  const end = o.path?.at(-1)
  if (o.path && (!end || !inContact(size, { x: end[0], y: end[1] }, target))) o.path = null
  return false
}

/**
 * A carriage going after an army (`CONTEXT.md`: Supply line) that need not drive this tick. With
 * the army gone, the drive or haul route ends. Where the order heads (`target`, or a haul route's
 * `to`) follows the army (`armySpot`), and a path that no longer
 * ends in contact with it is found again. In contact with the army, a supply wagon stands with it
 * and a haul route starts on its stop.
 */
function followHolds(
  world: WorldState,
  r: Resident,
  o: DriveOrder | HaulOrder,
  armyId: string,
  size: number,
): boolean {
  const spot = armySpot(world, armyId, r, size)
  if (!spot) {
    r.order = null
    return true
  }
  // A path found is kept while it ends in contact with the army (below), so heading always for
  // the spot itself costs no search; heading for a tile beside it could end two tiles off.
  const to = o.kind === 'drive' ? o.target : o.to
  to.x = spot.x
  to.y = spot.y
  if (inContact(size, r, spot)) {
    if (o.kind === 'haul') arrive(r, o)
    o.path = null
    o.progress = 0
    return true
  }
  const end = o.path?.at(-1)
  if (o.path && (!end || !inContact(size, { x: end[0], y: end[1] }, spot))) o.path = null
  return false
}

/**
 * A moving order got there: a walk or drive is done, a haul route starts on its stop, an attack
 * order waits for contact or its target's next move, a road order builds on its tile.
 */
function arrive(r: Resident, o: MoveOrder): void {
  if (o.kind === 'attack') {
    o.path = null
    o.progress = 0
    return
  }
  if (isLineOrder(o)) {
    o.phase = 'building'
    o.path = null
    o.progress = 0
    return
  }
  if (o.kind === 'store' || o.kind === 'fetch') {
    o.phase = o.kind === 'store' ? 'putting' : 'taking'
    o.path = null
    o.progress = 0
    return
  }
  // A supply wagon's drive lasts as long as its army (`followHolds`).
  if (o.kind === 'drive' && o.army !== undefined) {
    o.path = null
    o.progress = 0
    return
  }
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
 * searches in progress, which start again. Walls and gates block the way (`mayStep`); a step
 * they block, as a gate closed since the path was found, finds a new path instead.
 */
export class Walking {
  private finder: PathFinder
  private searching = new Map<string, string>()
  private walls: { key: string; map: WallMap } | undefined

  constructor(private terrain: TerrainMap) {
    this.finder = new PathFinder(terrain)
  }

  /** The walls and gates on the map, built again only when they change. */
  private wallsOf(world: WorldState): WallMap {
    const key = wallsKey(world)
    if (this.walls?.key !== key) this.walls = { key, map: wallMap(world, this.terrain) }
    return this.walls.map
  }

  /**
   * Requests this tick's steps for every walking resident and every driver. A driver goes at
   * their carriage's speed and learns Driving while they drive. On a finished road both go at
   * road speed, whatever the terrain beneath (`CONTEXT.md`: Road), and paths prefer roads.
   */
  requestSteps(world: WorldState, budgetMs = PATH_BUDGET_MS): StepAction[] {
    const roads = roadTiles(world, this.terrain.size)
    this.finder.setRoads(roads)
    this.finder.setWalls(this.wallsOf(world))
    const holding = new Set<string>()
    for (const r of world.residents) {
      const o = moveOrder(r)
      const armyId = armyDrivenTo(r)
      if ((o?.kind === 'drive' || o?.kind === 'haul') && armyId !== undefined) {
        if (followHolds(world, r, o, armyId, this.terrain.size)) holding.add(r.id)
      }
    }
    this.plan(world, budgetMs, holding)
    for (const r of world.residents) {
      const o = moveOrder(r)
      if (o?.kind === 'attack' && attackHolds(world, r, o, this.terrain.size)) holding.add(r.id)
      // A store or fetch order whose carriage moved on since its path was found finds a new one.
      if ((o?.kind === 'store' || o?.kind === 'fetch') && o.path) {
        const to = targetOf(world, o)
        const end = o.path.at(-1)
        if (to && end && (end[0] !== to.x || end[1] !== to.y)) o.path = null
      }
    }
    const waiting = waitingForArmy(world, holding)
    // And caravans with their escort (`CONTEXT.md`: Caravan).
    for (const id of waitingForEscort(world, this.terrain.size)) waiting.add(id)
    const steps: StepAction[] = []
    for (const r of world.residents) {
      const o = moveOrder(r)
      if (holding.has(r.id) || !o?.path) continue
      const next = o.path[0]
      if (!next) {
        arrive(r, o)
        continue
      }
      // Keeping together with their army (`CONTEXT.md`: Army).
      if (waiting.has(r.id)) continue
      const ground = groundAt(this.terrain, roads, next[0], next[1])
      if (!onFoot(o)) {
        o.progress += driveSpeed(r, ground)
        r.skills.driving = (r.skills.driving ?? 0) + drivingLearned(r, world.tick)
      } else {
        o.progress += walkSpeed(r, ground, world.tick)
      }
      // A diagonal step is further, so it waits for that much more progress (`CONTEXT.md`: Step).
      const length = stepLength(this.terrain.size, r.x, r.y, next[0], next[1]) || 1
      if (o.progress < length) continue
      const to = { x: next[0], y: next[1] }
      const carriageId = onFoot(o) ? undefined : o.carriageId
      steps.push({ kind: 'step', residentId: r.id, to, ...(carriageId ? { carriageId } : {}) })
    }
    return steps
  }

  /**
   * Finds paths for new walk and drive orders and haul routes' next legs; drops orders whose
   * target can't be reached.
   */
  private plan(world: WorldState, budgetMs: number, holding: Set<string>): void {
    for (const r of world.residents) {
      const o = moveOrder(r)
      if (!o || o.path || holding.has(r.id)) continue
      const target = targetOf(world, o)
      if (!target) continue
      // A new order for a resident replaces any search for their old one.
      const key = searchKey(world, o)
      if (this.searching.get(r.id) !== key) {
        const costs = onFoot(o) ? WALKING_COSTS : CARRIAGE_COSTS
        // An attacker only needs to come into contact, even with a defender up on a wall.
        // So does a carriage going after an army (`CONTEXT.md`: Supply line).
        const near = o.kind === 'attack' || armyDrivenTo(r) !== undefined
        const options = { realmId: wallSide(r), onWalls: onFoot(o), near }
        this.finder.request(r.id, [r.x, r.y], [target.x, target.y], costs, options)
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
      if (!o || o.path || searchKey(world, o) !== key) continue
      if (result.status === 'found') o.path = result.path.map(([x, y]) => [x, y])
      else endOrder(world, r, 'no way')
    }
  }

  /**
   * Resolves step actions (ADR 0002): a step happens only if the resident still exists, the
   * tile is one of the eight around them and can be entered, walls and gates letting them
   * (`mayStep`), and for a diagonal step both straight tiles beside it could be stepped onto too
   * (`CONTEXT.md`: Step). A driver's step also needs their carriage on their tile with a horse to
   * pull it, and tiles a carriage can enter; the carriage and its horse, hitched now if it
   * wasn't, go along. Each step taken uses up its length in tiles of progress.
   */
  resolve(world: WorldState, steps: StepAction[]): number {
    let taken = 0
    const roads = roadTiles(world, this.terrain.size)
    const walls = this.wallsOf(world)
    for (const step of steps) {
      const r = world.residents.find((x) => x.id === step.residentId)
      if (!r) continue
      const size = this.terrain.size
      const length = stepLength(size, r.x, r.y, step.to.x, step.to.y)
      const ground = groundAt(this.terrain, roads, step.to.x, step.to.y)
      if (!length || !isPassableTerrain(ground)) {
        r.order = null
        continue
      }
      const from = tileIndex(size, r.x, r.y)
      const to = tileIndex(size, step.to.x, step.to.y)
      const side = wallSide(r)
      const onWalls = !step.carriageId
      const stranded = strandedOnWall(walls, side, from)
      const enterable = (t: number) => {
        const g = groundAt(this.terrain, roads, t % size, Math.floor(t / size))
        return onWalls ? isPassableTerrain(g) : carriageCanEnter(g)
      }
      const corners = besideStep(size, r.x, r.y, step.to.x, step.to.y).every(
        (t) => enterable(t) && mayStep(walls, side, from, t, onWalls, stranded),
      )
      if (!corners || !mayStep(walls, side, from, to, onWalls, stranded)) {
        const o = moveOrder(r)
        if (o) {
          o.path = null
          o.progress = 0
        }
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
      o.progress -= length
      if (o.path.length === 0) arrive(r, o)
    }
    return taken
  }
}
