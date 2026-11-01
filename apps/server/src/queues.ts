import {
  commands,
  MAP_SIZE,
  QUEUE_STEP_KINDS,
  queueStepsProblem,
  runsScript,
  TICKS_PER_GAME_HOUR,
  type OrderRequest,
  type Queue,
  type QueueStep,
  type QueueStepRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { leaveArmies } from './armies.js'
import { carriageOrganization } from './crimes.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'
import { worldIndex } from './world-index.js'

/**
 * Queues (`CONTEXT.md`: Queue). The queue order gives a resident a list of steps, each an order
 * request; the edit-queue order replaces the steps of the one they work through. Every tick,
 * after the orders are applied and before scripts run, `QueueRunner` starts the current step by
 * applying its request as if it had been given on its own, and moves on once it is done or its
 * duration is up. Any order that isn't a step ends the queue (`OrderQueue`). While a defence
 * script runs, the queue waits, its step kept aside with what it interrupted.
 *
 * A step may act somewhere else than where the resident stands (Planning ahead): adding it only
 * checks that the places it names could make sense (`stepPlaceProblem`); whether it can start is
 * checked when its turn comes.
 */

/** Ticks in a game minute. */
const TICKS_PER_GAME_MINUTE = TICKS_PER_GAME_HOUR / 60

interface QueueRequest extends OrderRequest {
  kind: 'queue'
  residentId: string
  steps: QueueStepRequest[]
  loop?: boolean
}

interface EditQueueRequest extends OrderRequest {
  kind: 'editQueue'
  residentId: string
  steps: QueueStepRequest[]
  loop?: boolean
}

/** The step's order as kept: plain data, without whom it is for. */
function keptOrder(order: OrderRequest): OrderRequest {
  const kept = structuredClone(order)
  delete kept.residentId
  return kept
}

function keptStep(id: number, s: QueueStepRequest): QueueStep {
  return {
    id,
    order: keptOrder(s.order),
    ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
  }
}

/** A tile as an order names it, `{ x, y }`, rather than a place by its id. */
function isTile(p: unknown): p is { x: unknown; y: unknown } {
  return typeof p === 'object' && p !== null && 'x' in p && 'y' in p
}

/**
 * Why a step can't make sense wherever the resident stands when its turn comes (`CONTEXT.md`:
 * Queue, Planning ahead): a tile it names is off the map, a carriage or horse it names isn't
 * there, or isn't the realm's, or the city a relocate names isn't the realm's. A building it
 * names that is gone passes: the step is skipped when its turn comes. Everything else, such as
 * standing on the right tile, carrying the goods or a city's free housing, is checked when the
 * step starts.
 */
export function stepPlaceProblem(
  world: WorldState,
  realmId: string,
  order: OrderRequest,
  size = MAP_SIZE,
): string | undefined {
  const onMap = (p: { x: unknown; y: unknown }) =>
    [p.x, p.y].every((n) => typeof n !== 'number' || (Number.isInteger(n) && n >= 0 && n < size))
  const tiles = [order, order.at, order.from, order.to].filter(isTile)
  if (!tiles.every(onMap)) return 'that tile is off the map'
  const spot = (order.spot ?? {}) as Record<string, unknown>
  // A store's `to` or a fetch's `from` names a storage or stable, anyone's, or a carriage.
  const places = [order.to, order.from]
    .filter((p) => p !== undefined && p !== null && !isTile(p))
    .map((p) => (typeof p === 'object' ? (p as { id?: unknown }).id : p))
  // A building (workplace, stable, storage, site, wall) a step names may be gone by now, as one a
  // saved queue kept after it was torn down (`CONTEXT.md`: Saved queue): the step is given, and
  // skipped when its turn comes. So may a store's or fetch's storage, which no carriage is.
  for (const id of [order.carriageId, spot.carriageId, ...places]) {
    if (typeof id !== 'string') continue
    const k = world.carriages.find((x) => x.id === id)
    const isPlace = places.includes(id)
    if (!k && isPlace) continue
    if (!k) return 'no such carriage'
    if (carriageOrganization(k) !== realmId) return 'not a carriage of your realm'
  }
  const horseIds = Array.isArray(order.horseIds) ? (order.horseIds as unknown[]) : []
  for (const id of [order.horseId, ...horseIds]) {
    if (typeof id !== 'string') continue
    const horse = world.horses.find((h) => h.id === id)
    if (!horse) return 'no such horse'
    if (horse.realmId !== realmId) return 'not a horse of your realm'
  }
  if (order.kind === 'relocate') {
    const city = world.cities.find((c) => c.id === order.cityId)
    if (city?.realmId !== realmId) return 'not a city of your realm'
  }
  return undefined
}

/** Why one of the steps `checked` picks can't make sense (`stepPlaceProblem`). */
function placesProblem(
  world: WorldState,
  realmId: string,
  steps: QueueStepRequest[],
  checked: (s: QueueStepRequest) => boolean,
  terrain?: TerrainMap,
): string | undefined {
  for (const [i, s] of steps.entries()) {
    if (!checked(s)) continue
    const problem = stepPlaceProblem(world, realmId, s.order, terrain?.size)
    if (problem) return `step ${i + 1}: ${problem}`
  }
  return undefined
}

/** The resident the sender's queue order names, if they command them. */
function queuedResident(world: WorldState, sender: OrderSender, residentId: unknown) {
  const realm = realmOf(world, sender.userId)
  const r = world.residents.find((x) => x.id === residentId)
  return realm && commands(world, realm.id, r) ? { r: r!, realm } : undefined
}

/**
 * The queue order: one of the Player's residents works through the steps, from the first. It ends
 * whatever they were doing.
 */
export const queue: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<QueueRequest>
    const found = queuedResident(world, sender, o.residentId)
    if (!found) return 'not one of your residents'
    if (Array.isArray(o.steps) && o.steps.length === 0) return 'a queue needs a step'
    if (o.loop !== undefined && typeof o.loop !== 'boolean') return 'loop must be true or false'
    return (
      queueStepsProblem(o.steps) ??
      placesProblem(world, found.realm.id, o.steps!, () => true, terrain)
    )
  },
  apply(world, sender, order) {
    const o = order as QueueRequest
    const found = queuedResident(world, sender, o.residentId)
    if (!found) return
    const { r, realm } = found
    // A queue is an order of their own, so they leave their army (`CONTEXT.md`: Army).
    leaveArmies(world, new Set([r.id]))
    r.order = null
    r.queue = {
      realmId: realm.id,
      steps: o.steps.map((s, i) => keptStep(i + 1, s)),
      current: 0,
      startedAt: null,
      loop: o.loop === true,
      nextStepId: o.steps.length + 1,
    }
  },
}

/**
 * The edit-queue order: the steps of the queue a resident works through are replaced by these,
 * and loop set. A step with the `id` of one already there is that step; the current step keeps
 * going unless it was left out. Then the step now in its place starts, or, with none there, the
 * first one when the queue loops; otherwise the queue ends and the resident stops.
 */
export const editQueue: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<EditQueueRequest>
    const found = queuedResident(world, sender, o.residentId)
    if (!found) return 'not one of your residents'
    const q = found.r.queue
    if (!q) return 'not working through a queue'
    if (o.loop !== undefined && typeof o.loop !== 'boolean') return 'loop must be true or false'
    const problem = queueStepsProblem(o.steps)
    if (problem) return problem
    const ids = o.steps!.flatMap((s) => (s.id === undefined ? [] : [s.id]))
    if (new Set(ids).size !== ids.length) return 'a step is in the list twice'
    if (!ids.every((id) => q.steps.some((s) => s.id === id))) return 'no such step in the queue'
    // Only the steps added are checked: one already there whose place is gone since is skipped
    // when its turn comes, and can still be edited until then.
    return placesProblem(world, found.realm.id, o.steps!, (s) => s.id === undefined, terrain)
  },
  apply(world, sender, order) {
    const o = order as EditQueueRequest
    const r = queuedResident(world, sender, o.residentId)?.r
    const q = r?.queue
    if (!r || !q) return
    const current = q.steps[q.current]!
    const steps = o.steps.map((s) => keptStep(s.id ?? q.nextStepId++, s))
    if (o.loop !== undefined) q.loop = o.loop
    const kept = steps.findIndex((s) => s.id === current.id)
    q.steps = steps
    if (kept >= 0) {
      // The current step keeps going, but with the request and duration as edited.
      q.current = kept
      return
    }
    // The current step was removed: it stops, and the one in its place starts.
    stopStep(r)
    if (q.current >= steps.length && q.loop && steps.length > 0) q.current = 0
    else if (q.current >= steps.length) {
      delete r.queue
      return
    }
    q.startedAt = null
  },
}

/** The queue order kinds. */
export const queueOrders: Record<string, OrderKind> = { queue, editQueue }

/**
 * Stops what the resident's current step had them do; while their defence script runs, what it
 * interrupted (`CONTEXT.md`: Defence script), which then has nothing to go on with.
 */
function stopStep(r: Resident): void {
  if (r.interrupted) {
    r.interrupted = { order: null }
    return
  }
  r.order = null
  delete r.script
}

/** What `QueueRunner` needs from outside the world: the Players as orders' senders. */
export interface QueueHost {
  sender(userId: number): OrderSender | undefined
}

/** Works every resident's queue once a tick (`CONTEXT.md`: Queue). */
export class QueueRunner {
  /** `kinds` are all the order kinds a step may be, `runScript` and `task` among them. */
  constructor(
    private host: QueueHost,
    private kinds: Record<string, OrderKind>,
    private terrain?: TerrainMap,
  ) {}

  /**
   * Moves each queue on: a step that is done, or whose duration is up, ends, and the next one
   * starts. A step that ended in a failure, or can't start, is skipped and goes in the realm log.
   * Run after the orders are applied and before scripts run, so a step's script runs the tick
   * it starts.
   */
  runAll(world: WorldState): void {
    for (const r of world.residents) {
      const q = r.queue
      if (!q) continue
      // Hired out, lent back or taken: the Player who gave it no longer commands them.
      const realm = world.realms.find((x) => x.id === q.realmId)
      const sender = realm && this.host.sender(realm.userId)
      // Taken into an army, they follow its orders instead.
      const inArmy = world.armies.some((a) => a.memberIds.includes(r.id))
      // Looked up afresh for each: a step started before may have handed someone over.
      if (!sender || worldIndex(world).commanderOf(r) !== q.realmId || inArmy) {
        delete r.queue
        continue
      }
      // Defending themselves, the queue waits until their defence script hands back
      // (`CONTEXT.md`: Defence script).
      if (r.interrupted) continue
      if (q.startedAt !== null) {
        const step = q.steps[q.current]!
        const timeUp =
          step.minutes !== undefined &&
          world.tick - q.startedAt >= step.minutes * TICKS_PER_GAME_MINUTE
        const done = runsScript(step.order) ? !r.script : r.order === null
        if (!timeUp && !done) continue
        if (timeUp) stopStep(r)
        else {
          const failure = failureOf(r, q.startedAt)
          if (failure) skipped(world, r, q, failure)
        }
        if (!next(r, q)) continue
      }
      this.start(world, r, q, sender)
    }
  }

  /**
   * Starts the current step, checked as if given on its own; one that can't start is skipped,
   * and the next one tried. When none of the queue's steps can start, the queue ends.
   */
  private start(world: WorldState, r: Resident, q: Queue, sender: OrderSender): void {
    for (let tried = 1; tried <= q.steps.length; tried++) {
      const step = q.steps[q.current]!
      const order: OrderRequest = { ...structuredClone(step.order), residentId: r.id }
      // Own entries only, as `orderKindOf` (not imported: `orders.ts` imports this module): a kept
      // step named `"constructor"` must not find a function inherited from `Object.prototype`.
      const kind = Object.hasOwn(this.kinds, order.kind) ? this.kinds[order.kind] : undefined
      const reason = kind
        ? kind.validate(world, sender, order, this.terrain)
        : `unknown order: ${order.kind}`
      if (reason === undefined) {
        stopStep(r)
        // How their last store or fetch ended is kept until their next order, as for the UI's.
        delete r.orderEnded
        kind!.apply(world, sender, order, this.terrain)
        q.startedAt = world.tick
        return
      }
      const none = tried === q.steps.length
      skipped(world, r, q, reason, none)
      if (none) delete r.queue
      else if (!next(r, q)) return
    }
  }
}

/** Moves the queue to its next step; false when it ended instead. */
function next(r: Resident, q: Queue): boolean {
  q.startedAt = null
  if (q.current + 1 < q.steps.length) q.current++
  else if (q.loop) q.current = 0
  else {
    delete r.queue
    return false
  }
  return true
}

/**
 * Why the step that started at `startedAt` ended in a failure: a store or fetch ending early. A
 * relocate that didn't move in is left out: the realm log already says why (`relocateFailed`).
 */
function failureOf(r: Resident, startedAt: number): string | undefined {
  const ended = r.orderEnded
  if (!ended || ended.kind === 'relocate') return undefined
  return ended.tick >= startedAt && ended.reason !== null ? ended.reason : undefined
}

function skipped(world: WorldState, r: Resident, q: Queue, reason: string, queueEnded = false) {
  recordEvent(world, q.realmId, {
    kind: 'queueStepSkipped',
    residentId: r.id,
    name: r.name,
    step: q.current + 1,
    order: q.steps[q.current]!.order.kind,
    reason,
    ...(queueEnded ? { queueEnded: true as const } : {}),
  })
}

/**
 * Invariant (ADR 0004): every queue has steps, its current step is one of them and started no
 * later than now, its step ids are unique and below `nextStepId`, and no step is a queue.
 */
export const queuesSound: Invariant = {
  name: 'queues-sound',
  check: (world) => queueViolations(world),
}

function queueViolations(world: WorldState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  for (const r of world.residents) {
    const q = r.queue
    if (!q) continue
    const fail = (message: string) =>
      out.push({
        invariant: 'queues-sound',
        message: `${r.id}'s queue ${message}`,
        entityIds: [r.id],
      })
    if (!Number.isInteger(q.current) || q.current < 0 || q.current >= q.steps.length)
      fail(`is at step ${q.current} of ${q.steps.length}`)
    if (q.startedAt !== null && q.startedAt > world.tick)
      fail(`started a step at tick ${q.startedAt}, after ${world.tick}`)
    const ids = q.steps.map((s) => s.id)
    if (new Set(ids).size !== ids.length || ids.some((id) => id >= q.nextStepId))
      fail(`has step ids ${ids.join(', ')} with ${q.nextStepId} next`)
    for (const s of q.steps)
      if (!QUEUE_STEP_KINDS.includes(s.order.kind)) fail(`holds a ${s.order.kind} step`)
  }
  return out
}
