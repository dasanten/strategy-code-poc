import { useEffect, useRef } from 'react'
import { CHILD_GOODS } from './shared/narrowed.js'
import { GOODS } from './shared/world.js'
import { QUEUE_STEP_KINDS, neverEnds, queueSteps, stepLine } from './shared/queue.js'
import { TICKS_PER_GAME_HOUR } from './shared/time.js'
import { canWork } from './shared/stats.js'
import { isVesselId } from './shared/vessels.js'
import { covers } from './shared/footprint.js'
import type {
  Building,
  BuildingKind,
  City,
  Waypoint,
  Good,
  OrderRequest,
  Queue,
  QueueItem,
  QueueStep,
  QueueStepRequest,
  Resident,
  ScriptSummary,
  TrainingSubject,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './city-view.js'
import { GOOD_LABELS, subjectLabel } from './Residents.js'
import { gonePlace } from './saved-queues.js'
import {
  find,
  insertItems,
  isBlock,
  planSteps,
  timedItems,
  withIds,
  type PlanItem,
} from './plan-blocks.js'
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
  const before: PlanItem[] = r.queue
    ? itemsOf(r.queue)
    : r.order?.kind === 'walkTo' && !r.script
      ? [{ order: { kind: 'walkTo', ...r.order.target } }]
      : []
  const steps = withStep(before, order, at)
  return r.queue
    ? { kind: 'editQueue', residentId: r.id, steps }
    : { kind: 'queue', residentId: r.id, steps }
}

/**
 * The items with `order` added last, after a walk to `at` when it acts on its tile and the last
 * step doesn't already walk there; a step that never ends gets a duration once another follows.
 */
function withStep(before: PlanItem[], order: OrderRequest, at: Tile | undefined) {
  return timedItems([...before, ...stepsAfter(planSteps(before).at(-1), order, at)])
}

/**
 * The steps that add `order` after the step `last`: a walk to `at` first when it acts on that
 * tile and `last` doesn't already walk there.
 */
function stepsAfter(
  last: QueueStepRequest | undefined,
  order: OrderRequest,
  at: Tile | undefined,
): QueueStepRequest[] {
  const added: QueueStepRequest[] = []
  const here = at && actsHere(order) ? { x: at.x, y: at.y } : undefined
  if (here && !(last && walksTo(last.order, here)))
    added.push({ order: { kind: 'walkTo', ...here } })
  added.push({ order: withoutResident(order) })
  return added
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
 * A queue planned in this browser until it is given: on the group card (`CONTEXT.md`: Group,
 * Planning for a group), or on a resident's card as a draft until Start queue (`CONTEXT.md`:
 * Queue draft). Its items are steps and repeat blocks with ids of the plan's own,
 * and those of a resident's queue it was planned from.
 */
export interface QueuePlan {
  items: PlanItem[]
  loop: boolean
  /** The id the next step or block added gets. */
  nextStepId: number
}

/** A plan with no steps yet. */
export const EMPTY_PLAN: QueuePlan = { items: [], loop: false, nextStepId: 1 }

/**
 * The plan with its items as the planner edited them, and loop when given; new steps and blocks
 * get ids, and a step that never ends gets a duration once another follows it.
 */
export function editPlan(plan: QueuePlan, items: readonly PlanItem[], loop?: boolean): QueuePlan {
  const given = withIds(items, plan.nextStepId)
  return { items: timedItems(given.items), loop: loop ?? plan.loop, nextStepId: given.nextStepId }
}

/**
 * The plan with a step planned with Add step added last, or after the step or block `after` (the
 * planner's insert point, `CONTEXT.md`: Planner blocks), after a walk to `at` when it acts on
 * that tile and the step before doesn't already walk there, as a resident's own queue gets it
 * (`appendRequest`).
 */
export function planStep(
  plan: QueuePlan,
  order: OrderRequest,
  at?: Tile,
  after?: number,
): QueuePlan {
  const added = stepsAfter(stepBefore(plan.items, after), order, at)
  return editPlan(plan, insertItems(plan.items, after, added))
}

/** The step a step inserted after `after` (or at the end) follows: the last one up to there. */
function stepBefore(items: readonly PlanItem[], after: number | undefined) {
  const mark = -1
  const marked = planSteps(insertItems(items, after, [{ id: mark, order: { kind: 'dismount' } }]))
  return marked[marked.findIndex((s) => s.id === mark) - 1]
}

/**
 * The draft a step planned for a resident goes onto (`CONTEXT.md`: Queue draft): the open one,
 * or a new one when they have no queue. None while a queue runs and no draft is open: the step is
 * added to the running queue at once.
 */
export function draftFor(
  r: Partial<Pick<Resident, 'queue'>>,
  draft: QueuePlan | undefined,
): QueuePlan | undefined {
  return draft ?? (r.queue ? undefined : EMPTY_PLAN)
}

/**
 * The draft an edit of a resident's planner with no draft open (a paste, a load, steps wrapped in
 * a repeat block) makes, or none when it edits the running queue live: only a resident with no
 * queue gets a draft. A running queue takes repeat blocks as they are (ADR 0032).
 */
export function draftEdit(
  r: Partial<Pick<Resident, 'queue'>>,
  items: readonly PlanItem[],
  loop?: boolean,
): QueuePlan | undefined {
  if (!r.queue) return editPlan(EMPTY_PLAN, items, loop)
  return undefined
}

/**
 * The items the planner's Clear leaves (`CONTEXT.md`: Clear): none in a draft or a group's plan;
 * in a running queue only the step the resident is on (`currentId`), so they finish it and the
 * queue ends once loop is off too.
 */
export function clearedItems(items: readonly PlanItem[], currentId?: number): PlanItem[] {
  if (currentId === undefined) return []
  const step = find(items, currentId)
  return step && !isBlock(step) ? [step] : []
}

/** A resident's queue as a plan: Edit as draft, and the running queue's planner. */
export function planOf(q: Pick<Queue, 'items' | 'loop' | 'nextStepId'>): QueuePlan {
  return { items: itemsOf(q), loop: q.loop, nextStepId: q.nextStepId }
}

/**
 * Give to all: each member's queue becomes a copy of the plan, its repeat blocks as they are, one
 * `queue` request each, ending what they do. A member who can't do a step gets it anyway and
 * skips it when its turn comes.
 */
export function giveToAll(plan: QueuePlan, residents: readonly Pick<Resident, 'id'>[]) {
  const steps = keepIds(plan.items, new Set())
  return residents.map((r): OrderRequest => ({
    kind: 'queue',
    residentId: r.id,
    steps,
    loop: plan.loop,
  }))
}

/**
 * The order giving a resident the plan, its repeat blocks as they are: an edit of the queue they
 * work through, keeping the steps and blocks it still has (the current step keeps going, each
 * block its round), or a new queue when it has ended since.
 */
export function givePlan(
  r: Pick<Resident, 'id'> & Partial<Pick<Resident, 'queue'>>,
  plan: Pick<QueuePlan, 'items'> & { loop?: boolean },
): OrderRequest {
  const kept = new Set(r.queue ? idsOfQueue(r.queue.items) : [])
  return queueRequest(r, keepIds(plan.items, kept), plan.loop)
}

/** The items with the ids in `kept` and no others: a step or block new to the queue has none. */
function keepIds(items: readonly PlanItem[], kept: ReadonlySet<number>): PlanItem[] {
  return items.map((item): PlanItem => {
    const id = item.id !== undefined && kept.has(item.id) ? { id: item.id } : {}
    if (isBlock(item)) return { ...id, repeat: item.repeat, items: keepIds(item.items, kept) }
    const minutes = item.minutes === undefined ? {} : { minutes: item.minutes }
    return { ...id, order: item.order, ...minutes }
  })
}

/** Every id in a queue's items, steps and blocks. */
function idsOfQueue(items: readonly QueueItem[]): number[] {
  return items.flatMap((item) => [item.id, ...('repeat' in item ? idsOfQueue(item.items) : [])])
}

/**
 * The queue's items as an edit-queue request keeps them: each step and block by its id, without
 * the rounds the server counts.
 */
export function itemsOf(q: Pick<Queue, 'items'>): PlanItem[] {
  const keep = (items: readonly QueueItem[]): PlanItem[] =>
    items.map((item) => {
      if ('repeat' in item) return { id: item.id, repeat: item.repeat, items: keep(item.items) }
      const minutes = item.minutes === undefined ? {} : { minutes: item.minutes }
      return { id: item.id, order: item.order, ...minutes }
    })
  return keep(q.items)
}

/** The round each block around the current step is on, by block id; other blocks run none. */
export function roundsOf(q: Pick<Queue, 'items'>): Map<number, number> {
  const out = new Map<number, number>()
  const walk = (items: readonly QueueItem[]) => {
    for (const item of items) {
      if (!('repeat' in item)) continue
      if (item.round) out.set(item.id, item.round)
      walk(item.items)
    }
  }
  walk(q.items)
  return out
}

/** Orders that act on the tile they are given for (by the card, their own): they only start there. */
function actsHere(order: OrderRequest): boolean {
  if (
    ['pickUp', 'drop', 'drive', 'mount', 'board', 'unhitch', 'hitch', 'teach', 'feed'].includes(
      order.kind,
    )
  )
    return true
  // A Build line walks to its line itself (`CONTEXT.md`: Build line); Explore acts on no place.
  if (order.kind !== 'task' || order.task === 'buildLine' || order.task === 'explore') return false
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

/**
 * The order making these the resident's queue: an edit of the queue they work through, or a
 * `queue` order starting one when they have none, as a paste into an empty planner does
 * (`CONTEXT.md`: Planner clipboard). With no steps, the edit ends the queue.
 */
export function queueRequest(
  r: Pick<Resident, 'id'> & Partial<Pick<Resident, 'queue'>>,
  steps: PlanItem[],
  loop?: boolean,
): OrderRequest {
  if (r.queue) return editRequest(r, steps, loop)
  return { kind: 'queue', residentId: r.id, steps, ...(loop === undefined ? {} : { loop }) }
}

/** The order editing the resident's queue to these steps. */
export function editRequest(
  r: Pick<Resident, 'id'>,
  steps: PlanItem[],
  loop?: boolean,
): OrderRequest {
  return { kind: 'editQueue', residentId: r.id, steps, ...(loop === undefined ? {} : { loop }) }
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
  /** Why its place is gone, if it is: "the workplace is gone" (`CONTEXT.md`: Saved queue). */
  gone?: string
  /** The Orders tab heading its kind of order is under, which picks its icon. */
  group: StepGroup
}

/** The Orders tab's kinds of order a step's icon shows (`CONTEXT.md`: Planner blocks). */
export type StepGroup = 'move' | 'work' | 'goods' | 'scripts'

/** Which kind each order is; one not listed is work. */
const STEP_GROUP: Partial<Record<OrderRequest['kind'], StepGroup>> = {
  walkTo: 'move',
  drive: 'move',
  board: 'move',
  row: 'move',
  sail: 'move',
  unhitch: 'move',
  hitch: 'move',
  getOff: 'move',
  mount: 'move',
  dismount: 'move',
  relocate: 'move',
  pickUp: 'goods',
  drop: 'goods',
  store: 'goods',
  fetch: 'goods',
  feed: 'goods',
  haul: 'move',
  runScript: 'scripts',
}

/** The kind of order a step is, for its icon: as the Orders tab groups it: Explore and Haul move. */
export function stepGroup(order: OrderRequest): StepGroup {
  if (order.kind === 'task' && order.task === 'explore') return 'move'
  if (order.kind === 'task' && order.task === 'haul') return 'move'
  return STEP_GROUP[order.kind] ?? 'work'
}

/**
 * Whether a step's duration chip shows (`CONTEXT.md`: Planner blocks): when it has a duration,
 * or needs one, never ending on its own and not being the last step.
 */
export function showsMinutes(row: Pick<QueueRow, 'minutes' | 'endless'>, last: boolean): boolean {
  return row.minutes !== undefined || (row.endless && !last)
}

/** A building as step labels name it: by kind, with its city, found by id or by a tile it covers. */
type NamedBuilding = Pick<Building, 'id' | 'kind'> & Partial<Pick<Building, 'x' | 'y' | 'cityId'>>

/**
 * What step labels name: the Player's scripts, the buildings in sight and those last seen, and
 * the cities they know.
 */
export interface StepNames {
  scripts?: readonly Pick<ScriptSummary, 'id' | 'name'>[]
  buildings?: readonly NamedBuilding[]
  lastSeen?: readonly NamedBuilding[]
  cities?: readonly Pick<City, 'id' | 'name'>[]
  /** The Player's waypoints: a step at one's tile names it (`CONTEXT.md`: Waypoint). */
  waypoints?: readonly Pick<Waypoint, 'name' | 'x' | 'y'>[]
}

/**
 * The queue as the card lists it, step by step. With the buildings last seen given, a step whose
 * place is gone from the map is flagged (`gonePlace`), as a saved queue's step loaded after its
 * workplace was torn down.
 */
export function queueRows(q: Pick<Queue, 'items' | 'current'>, names: StepNames = {}): QueueRow[] {
  return queueSteps(q.items).map((s) => stepRow(s, s.id === q.current, names))
}

/** One step as the card lists it, in a queue or a plan's repeat block. */
export function stepRow(
  s: Pick<QueueStep, 'id' | 'order' | 'minutes'>,
  current: boolean,
  names: StepNames = {},
): QueueRow {
  const { buildings = [], lastSeen } = names
  const gone = lastSeen && gonePlace(s.order, { buildings, lastSeen })
  return {
    id: s.id,
    label: stepLabel(s.order, names),
    current,
    ...(s.minutes === undefined ? {} : { minutes: s.minutes, real: realMinutes(s.minutes) }),
    endless: neverEnds(s.order),
    ...(gone ? { gone } : {}),
    group: stepGroup(s.order),
  }
}

/** A duration in game minutes as real time, "10 s", "1 min". */
export const realMinutes = (minutes: number) => realTimeOf(minutes * TICKS_PER_GAME_MINUTE)

/**
 * What a queue step does, as the card lists it, its place by name (`CONTEXT.md`: Planner blocks):
 * "Work the farm in Quarrytown IV", "Walk to Farm, Quarrytown IV", "Walk to Pass" (a waypoint),
 * "Walk to 12, 6" (a bare tile).
 */
export function stepLabel(
  order: OrderRequest,
  { scripts = [], buildings = [], lastSeen = [], cities = [], waypoints = [] }: StepNames,
): string {
  const cityOf = (b: NamedBuilding) => cities.find((c) => c.id === b.cityId)?.name
  // A tile by name: a waypoint on it, else a building covering it with its city, else coordinates.
  const at = (p: unknown) => {
    const { x, y } = p as { x: number; y: number }
    const marked = waypoints.find((w) => w.x === x && w.y === y)
    if (marked) return marked.name
    const onIt = (b: NamedBuilding) =>
      b.x !== undefined && b.y !== undefined && covers({ kind: b.kind, x: b.x, y: b.y }, x, y)
    const seen = buildings.find(onIt)
    const was = seen ? undefined : lastSeen.find(onIt)
    const b = seen ?? was
    if (!b) return `${x}, ${y}`
    const name = capitalised(BUILDING_NAMES[b.kind])
    const city = cityOf(b)
    return `${name}${city ? `, ${city}` : ''}${was ? ' (as last seen)' : ''}`
  }
  const building = (id: unknown) => {
    const seen = buildings.find((b) => b.id === id)
    const b = seen ?? lastSeen.find((l) => l.id === id)
    if (!b) return 'the building'
    const city = cityOf(b)
    return `the ${BUILDING_NAMES[b.kind]}${city ? ` in ${city}` : ''}${seen ? '' : ' (as last seen)'}`
  }
  // A storage or stable in sight a store or fetch names, if it names one, or a boat; a carriage
  // goes unnamed.
  const named = (word: string, id: unknown) => {
    if (typeof id === 'string' && isVesselId(id))
      return `${word} the ${id.startsWith('ship') ? 'ship' : 'boat'}`
    const b = buildings.find((b) => b.id === id)
    if (!b) return ''
    const city = cityOf(b)
    return `${word} the ${BUILDING_NAMES[b.kind]}${city ? ` in ${city}` : ''}`
  }
  switch (order.kind) {
    case 'walkTo':
      return `Walk to ${at(order)}`
    case 'drive':
      return `Drive the carriage to ${at(order)}`
    case 'board': {
      const vessel = (order.vesselId ?? order.carriageId) as string | undefined
      if (!isVesselId(vessel)) return 'Board the carriage'
      // Named after its kind, as the server names its ids (`isVesselId`).
      if (vessel!.startsWith('ship')) return order.asCrew ? 'Crew the ship' : 'Board the ship'
      return 'Board the boat'
    }
    case 'row':
      return `Row the boat to ${at(order)}`
    case 'sail':
      return `Sail the ship to ${at(order)}`
    case 'unhitch':
      return 'Unhitch the horse'
    case 'hitch':
      return 'Hitch a horse'
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
    case 'teach':
      return `Teach ${subjectLabel(order.subject as TrainingSubject)} at ${building(order.buildingId)}`
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
    case 'relocate':
      return `Relocate to ${cities.find((c) => c.id === order.cityId)?.name ?? 'another city'}`
    case 'feed':
      return `Feed: ${String(order.units)} Food`
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
      if (order.task === 'train') return `Train at ${building(order.groundId)}`
      if (order.task === 'explore') return 'Explore'
      if (order.task === 'buildLine') {
        const line = stepLine(order)
        if (!line) return 'Build a line'
        return `Build a ${line.building} line from ${at(line.from)} to ${at(line.to)}`
      }
      return `Haul to ${at(order)}`
  }
  return order.kind
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
