import { useEffect, useRef } from 'react'
import {
  CHILD_GOODS,
  GOODS,
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_STEP_KINDS,
  TICKS_PER_GAME_HOUR,
  canWork,
  neverEnds,
  type Building,
  type BuildingKind,
  type Good,
  type OrderRequest,
  type Queue,
  type QueueStepRequest,
  type Resident,
  type ScriptSummary,
} from '@csp/shared'
import { BUILDING_NAMES } from './city-view.js'
import { GOOD_LABELS } from './Residents.js'
import { realTimeOf } from './wiki-view.js'

/**
 * Queues on the resident card (`CONTEXT.md`: Queue): holding Shift while giving an order appends
 * it to the resident's queue instead of replacing what they do, and the card lists the queue to
 * reorder, remove, time and loop its steps. Every change is a `queue` or `editQueue` order the
 * server checks (ADR 0002).
 */

/** What appending needs of a resident: where they stand, what they do and their queue. */
export type Queued = Pick<Resident, 'id' | 'x' | 'y'> &
  Partial<Pick<Resident, 'order' | 'script' | 'queue'>>

/** A tile, where an order acts. */
type Tile = { x: number; y: number }

/** Ticks in a game minute. */
const TICKS_PER_GAME_MINUTE = TICKS_PER_GAME_HOUR / 60

/** The Store order the card gives: everything carried, keeping their own Food. */
export const STORE_ALL = { kind: 'store', goods: [...GOODS] } satisfies OrderRequest

/** `STORE_ALL` for this resident: a child stores only the goods children may (`CONTEXT.md`: Child). */
export function storeAll(r: Pick<Resident, 'bornAt'>, tick: number): typeof STORE_ALL {
  return canWork(r as Resident, tick) ? STORE_ALL : { kind: 'store', goods: [...CHILD_GOODS] }
}

/**
 * The order that appends `order` to the resident's queue, or starts one with it: a `queue` order
 * when they have none, an `editQueue` order keeping every step they have. Undefined when the order
 * can't be a queue step (stop, attack, …), so it is given as it is.
 *
 * A walk they are on (not one of a script's) becomes the queue's first step. An order acting on
 * a tile (work, build, pick up, …) is put after a walk to it, unless the step before already
 * walks there, so it still finds them there when its turn comes, and on every round of a loop.
 * That tile is `at`, by default the one they stand on, as their card gives such orders. A step
 * that never ends on its own gets `QUEUE_DEFAULT_STEP_MINUTES` once another follows it.
 */
export function appendRequest(
  r: Queued,
  order: OrderRequest,
  at: Tile = { x: r.x, y: r.y },
): OrderRequest | undefined {
  if (!QUEUE_STEP_KINDS.includes(order.kind)) return undefined
  const before: QueueStepRequest[] = r.queue
    ? stepsOf(r.queue)
    : r.order?.kind === 'walkTo' && !r.script
      ? [{ order: { kind: 'walkTo', ...r.order.target } }]
      : []
  const steps = withStep(before, order, at)
  return r.queue
    ? { kind: 'editQueue', residentId: r.id, steps }
    : { kind: 'queue', residentId: r.id, steps }
}

/**
 * The steps with `order` added last, after a walk to `at` when it acts on its tile and the step
 * before doesn't already walk there; a step that never ends gets a duration once another follows.
 */
function withStep(before: QueueStepRequest[], order: OrderRequest, at: Tile | undefined) {
  const added: QueueStepRequest[] = []
  const here = at && actsHere(order) ? { x: at.x, y: at.y } : undefined
  const last = before.at(-1)?.order
  if (here && !(last && walksTo(last, here))) added.push({ order: { kind: 'walkTo', ...here } })
  added.push({ order: withoutResident(order) })
  return timed([...before, ...added])
}

/**
 * The orders appending to each of several residents' queues, `orderFor` giving each one's order
 * and `atFor` the tile it acts on, if not where they stand: those whose order can't be a step get
 * it as it is.
 */
export function appendRequests<R extends Queued>(
  residents: readonly R[],
  orderFor: (r: R) => OrderRequest,
  atFor: (r: R) => Tile | undefined = () => undefined,
): OrderRequest[] {
  return residents.map((r) => {
    const order = orderFor(r)
    return appendRequest(r, order, atFor(r)) ?? order
  })
}

/**
 * A step planned with Add step for a group with no plan open: added after each member's own steps
 * (`appendRequests`), after a walk to `at` when it acts on that tile.
 */
export function appendToEach(
  residents: readonly Queued[],
  order: OrderRequest,
  at?: Tile,
): OrderRequest[] {
  return appendRequests(
    residents,
    (r) => ({ ...order, residentId: r.id }),
    () => at,
  )
}

/**
 * A queue planned on the group card (`CONTEXT.md`: Group, Planning for a group), held in this
 * browser until it is given to all: steps with ids of the plan's own, none of them current.
 */
export type QueuePlan = Pick<Queue, 'steps' | 'current' | 'loop' | 'nextStepId'>

/** A plan with no steps yet. */
export const EMPTY_PLAN: QueuePlan = { steps: [], current: -1, loop: false, nextStepId: 1 }

/** The plan with its steps as the planner edited them, and loop when given; new steps get ids. */
export function editPlan(plan: QueuePlan, steps: QueueStepRequest[], loop?: boolean): QueuePlan {
  let nextStepId = plan.nextStepId
  return {
    steps: steps.map((s) => ({
      id: s.id ?? nextStepId++,
      order: s.order,
      ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
    })),
    current: -1,
    loop: loop ?? plan.loop,
    nextStepId,
  }
}

/**
 * The plan with a step planned with Add step added last, after a walk to `at` when it acts on
 * that tile, as a resident's own queue gets it (`appendRequest`).
 */
export function planStep(plan: QueuePlan, order: OrderRequest, at?: Tile): QueuePlan {
  return editPlan(plan, withStep(stepsOf(plan), order, at))
}

/**
 * Give to all: each member's queue becomes a copy of the plan, one `queue` request each, ending
 * what they do. A member who can't do a step gets it anyway and skips it when its turn comes.
 */
export function giveToAll(plan: QueuePlan, residents: readonly Pick<Resident, 'id'>[]) {
  const steps = stepsOf(plan).map(({ order, minutes }) => ({
    order,
    ...(minutes === undefined ? {} : { minutes }),
  }))
  return residents.map((r): OrderRequest => ({
    kind: 'queue',
    residentId: r.id,
    steps,
    loop: plan.loop,
  }))
}

/** The queue's steps as an edit-queue request keeps them: each by its id. */
export function stepsOf(q: Pick<Queue, 'steps'>): QueueStepRequest[] {
  return q.steps.map((s) => ({
    id: s.id,
    order: s.order,
    ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
  }))
}

/** The steps with every one that never ends on its own, and isn't last, given a duration. */
function timed(steps: QueueStepRequest[]): QueueStepRequest[] {
  return steps.map((s, i) =>
    s.minutes === undefined && neverEnds(s.order) && i < steps.length - 1
      ? { ...s, minutes: QUEUE_DEFAULT_STEP_MINUTES }
      : s,
  )
}

/** Orders that act on the tile they are given for (by the card, their own): they only start there. */
function actsHere(order: OrderRequest): boolean {
  if (['pickUp', 'drop', 'drive', 'mount', 'board'].includes(order.kind)) return true
  if (order.kind !== 'task') return false
  // A Build task laid out somewhere else (`at`) walks there itself.
  return order.task !== 'build' || order.at === undefined
}

function walksTo(order: OrderRequest, at: { x: number; y: number }): boolean {
  return order.kind === 'walkTo' && order.x === at.x && order.y === at.y
}

function withoutResident(order: OrderRequest): OrderRequest {
  const step = { ...order }
  delete step.residentId
  return step
}

/** The order editing the resident's queue to these steps. */
export function editRequest(
  r: Pick<Resident, 'id'>,
  steps: QueueStepRequest[],
  loop?: boolean,
): OrderRequest {
  return { kind: 'editQueue', residentId: r.id, steps, ...(loop === undefined ? {} : { loop }) }
}

/** The steps with one moved up (-1) or down (+1); a step that never ends gets a duration. */
export function moveStep(q: Pick<Queue, 'steps'>, id: number, by: -1 | 1): QueueStepRequest[] {
  const steps = stepsOf(q)
  const i = steps.findIndex((s) => s.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= steps.length) return steps
  ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
  return timed(steps)
}

/** The steps with one dragged to the place of another. */
export function dropStep(q: Pick<Queue, 'steps'>, id: number, onto: number): QueueStepRequest[] {
  const steps = stepsOf(q)
  const from = steps.findIndex((s) => s.id === id)
  const to = steps.findIndex((s) => s.id === onto)
  if (from < 0 || to < 0) return steps
  steps.splice(to, 0, ...steps.splice(from, 1))
  return timed(steps)
}

/** The steps without one; with none left, the edit ends the queue. */
export function removeStep(q: Pick<Queue, 'steps'>, id: number): QueueStepRequest[] {
  return stepsOf(q).filter((s) => s.id !== id)
}

/** The steps with one's duration set in game minutes, or cleared with undefined. */
export function timeStep(
  q: Pick<Queue, 'steps'>,
  id: number,
  minutes: number | undefined,
): QueueStepRequest[] {
  return stepsOf(q).map((s) => {
    if (s.id !== id) return s
    const step = { ...s, minutes }
    if (minutes === undefined) delete step.minutes
    return step
  })
}

/** One step as the card lists it. */
export interface QueueRow {
  id: number
  /** "Work the farm", "Walk to 12, 6". */
  label: string
  /** The step being done. */
  current: boolean
  /** Its duration in game minutes, if it has one. */
  minutes?: number
  /** The duration in real time, "1 min". */
  real?: string
  /** It never ends on its own: work or haul. */
  endless: boolean
}

/** What step labels name: the Player's scripts, the buildings in sight and those last seen. */
export interface StepNames {
  scripts?: readonly Pick<ScriptSummary, 'id' | 'name'>[]
  buildings?: readonly Pick<Building, 'id' | 'kind'>[]
  lastSeen?: readonly Pick<Building, 'id' | 'kind'>[]
}

/** The queue as the card lists it, step by step. */
export function queueRows(q: Pick<Queue, 'steps' | 'current'>, names: StepNames = {}): QueueRow[] {
  return q.steps.map((s, i) => ({
    id: s.id,
    label: stepLabel(s.order, names),
    current: i === q.current,
    ...(s.minutes === undefined ? {} : { minutes: s.minutes, real: realMinutes(s.minutes) }),
    endless: neverEnds(s.order),
  }))
}

/** A duration in game minutes as real time, "10 s", "1 min". */
export const realMinutes = (minutes: number) => realTimeOf(minutes * TICKS_PER_GAME_MINUTE)

/** What a queue step does, as the card lists it: "Work the farm", "Walk to 12, 6". */
export function stepLabel(
  order: OrderRequest,
  { scripts = [], buildings = [], lastSeen = [] }: StepNames,
): string {
  const at = (p: unknown) => {
    const { x, y } = p as { x: number; y: number }
    return `${x}, ${y}`
  }
  const building = (id: unknown) => {
    const kind = buildings.find((b) => b.id === id)?.kind
    if (kind) return `the ${BUILDING_NAMES[kind]}`
    const was = lastSeen.find((b) => b.id === id)?.kind
    return was ? `the ${BUILDING_NAMES[was]} (as last seen)` : 'the building'
  }
  // A storage or stable in sight a store or fetch names, if it names one; a carriage goes unnamed.
  const named = (word: string, id: unknown) => {
    const kind = buildings.find((b) => b.id === id)?.kind
    return kind ? `${word} the ${BUILDING_NAMES[kind]}` : ''
  }
  switch (order.kind) {
    case 'walkTo':
      return `Walk to ${at(order)}`
    case 'drive':
      return `Drive the carriage to ${at(order)}`
    case 'board':
      return 'Board the carriage'
    case 'getOff':
      return order.x === undefined ? 'Get off' : `Get off at ${at(order)}`
    case 'pickUp':
      return `Pick up ${goodsLine(order.goods)}`
    case 'drop':
      return `${dropVerb(order.spot)} ${goodsLine(order.goods)}`
    case 'store': {
      const what =
        order.goods && !Array.isArray(order.goods)
          ? `Store ${goodsLine(order.goods)}`
          : 'Store what they carry'
      return `${what}${named(' at', order.to)}`
    }
    case 'fetch':
      return `Fetch ${goodsLine(order.goods)}${named(' from', order.from)}`
    case 'build':
      return 'Build'
    case 'tearDown':
      return `Tear down ${building(order.buildingId)}`
    case 'workAt':
      return `Work ${building(order.buildingId)}`
    case 'haul':
      return 'Haul'
    case 'roadLine':
      return `Build a road to ${at(order.to)}`
    case 'mount':
      return 'Mount a horse'
    case 'dismount':
      return 'Dismount'
    case 'wallLine':
      return `Build a wall to ${at(order.to)}`
    case 'runScript': {
      const script = scripts.find((s) => s.id === order.scriptId)
      return `Run ${script?.name ?? 'a script'}`
    }
    case 'task':
      if (order.task === 'work') return `Work ${building(order.workplaceId)}`
      if (order.task === 'build') {
        const name = BUILDING_NAMES[order.building as BuildingKind] ?? 'something'
        return `Build ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
      }
      if (order.task === 'tearDown') return `Tear down ${building(order.buildingId)}`
      if (order.task === 'feedStable') return `Feed ${building(order.stableId)}`
      if (order.task === 'breed') return `Breed horses at ${building(order.stableId)}`
      return `Haul to ${at(order)}`
  }
  return order.kind
}

function dropVerb(spot: unknown): string {
  const kind = (spot as { kind?: string } | undefined)?.kind
  if (kind === 'storage') return 'Store'
  if (kind === 'site') return 'Deliver'
  if (kind === 'carriage') return 'Load'
  return 'Drop'
}

/** "5 wood and 2 iron", "wood": units where the order names them. */
function goodsLine(goods: unknown): string {
  const entries: [string, unknown][] = Array.isArray(goods)
    ? goods.map((g) => [g as string, null])
    : Object.entries((goods ?? {}) as Record<string, unknown>)
  const parts = entries.map(([good, units]) => {
    const name = (GOOD_LABELS[good as Good] ?? good).toLowerCase()
    return typeof units === 'number' ? `${units} ${name}` : name
  })
  if (parts.length === 0) return 'goods'
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * Whether Shift is held, as of the last key or pointer event: read when an order is given, so a
 * button, a key or a map pick with Shift held appends to the queue.
 */
export function useShiftHeld(): { readonly current: boolean } {
  const held = useRef(false)
  useEffect(() => {
    const seen = (e: KeyboardEvent | PointerEvent | MouseEvent) => {
      held.current = e.shiftKey
    }
    const lost = () => {
      held.current = false
    }
    const events = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click'] as const
    for (const name of events) window.addEventListener(name, seen, true)
    window.addEventListener('blur', lost)
    return () => {
      for (const name of events) window.removeEventListener(name, seen, true)
      window.removeEventListener('blur', lost)
    }
  }, [])
  return held
}
