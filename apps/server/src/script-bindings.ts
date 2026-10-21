import {
  NativeFunction,
  ScriptFunction,
  ScriptRuntimeError,
  type ScriptObject,
  type Value,
} from '@csp/lang'
import {
  ARMY_SCRIPT_API,
  HAUL_KEEP_FOOD,
  SCRIPT_API,
  Terrain,
  ageInYears,
  directivesFor,
  organizationLabel,
  terrainAt,
  wrapDistance,
  type OrderRequest,
  type ResourceNode,
  type ScriptBinding,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { orderKinds, type OrderKind, type OrderSender } from './orders.js'

/**
 * The game API bound for a running script (`CONTEXT.md`: Script, Memory, Step budget; ADR 0002).
 * `SCRIPT_API` in `@csp/shared` lists the names and their step costs; this gives them their
 * meaning for one resident in one tick.
 *
 * Queries read only what the Player sees and has explored. Actions build the very order request
 * the UI sends for `me` and check it with the same order kind, so a script can request nothing
 * an order couldn't; accepted requests are collected for the caller to apply like UI orders.
 */

/** What one run of a resident's script may look at and act for. */
export interface ScriptContext {
  world: WorldState
  terrain: TerrainMap
  /** The Player whose script it is, as an order's sender. */
  sender: OrderSender
  /** The resident running the script; one of the Player's. Not used with `armyId`. */
  residentId?: string
  /** The army running the script instead; one of the Player's. */
  armyId?: string
  /** The script's memory for this resident or army, kept by the caller between ticks. */
  memory: ScriptObject
  /** Everything the Player sees (`entitiesInSight`); called at most once a run. */
  seen: () => readonly SeenEntity[]
  /** Whether the Player has explored a tile (`ExploredTerrain.isExplored`). */
  explored: (x: number, y: number) => boolean
  /** The order kinds actions go through; the game's own by default. */
  kinds?: Record<string, OrderKind>
}

export interface ScriptBindings {
  /** The globals to run the script with (`RunOptions.globals`). */
  globals: Record<string, Value>
  /** The order requests the script's actions asked for and that were accepted, in order. */
  requests: OrderRequest[]
}

/** The order kinds a resident's script can request: one per action in `SCRIPT_API`. */
export const SCRIPT_ORDER_KINDS: readonly string[] = SCRIPT_API.filter(
  (b) => b.is === 'action',
).map((b) => b.name)

/** The army order each action of an army's script asks for (`ARMY_SCRIPT_API`). */
export const ARMY_SCRIPT_ORDERS: Readonly<Record<string, string>> = {
  walkTo: 'armyWalkTo',
  guard: 'armyGuard',
  attack: 'armyAttack',
  follow: 'armyFollow',
  stop: 'armyStop',
}

/** The order kinds an army's script can request: one per action in `ARMY_SCRIPT_API`. */
export const ARMY_SCRIPT_ORDER_KINDS: readonly string[] = ARMY_SCRIPT_API.filter(
  (b) => b.is === 'action',
).map((b) => ARMY_SCRIPT_ORDERS[b.name]!)

const TERRAIN_NAMES = new Map<number, string>(
  Object.entries(Terrain).map(([name, code]) => [code, name.toLowerCase()]),
)

/** Binds the game API for one run of a resident's script, or an army's with `armyId`. */
export function bindScript(context: ScriptContext): ScriptBindings {
  const { world, terrain, sender } = context
  const kinds = context.kinds ?? orderKinds
  const requests: OrderRequest[] = []

  let seen: readonly SeenEntity[] | undefined
  const seenOf = (is: SeenEntity['is']): Value => {
    seen ??= context.seen()
    return seen.filter((e) => e.is === is).map(({ is: _, ...rest }) => toValue(rest))
  }
  let nodes: Value[] | undefined
  const exploredNodes = (): Value => {
    nodes ??= world.nodes
      .filter((n: ResourceNode) => context.explored(n.x, n.y))
      .map((n) => toValue(n))
    return nodes
  }

  const queries: Record<string, (args: Value[]) => Value> = {
    residents: () => seenOf('resident'),
    buildings: () => seenOf('building'),
    cities: () => seenOf('city'),
    horses: () => seenOf('horse'),
    carriages: () => seenOf('carriage'),
    piles: () => seenOf('pile'),
    nodes: exploredNodes,
    directives: () =>
      directivesFor(world, (org) => organizationLabel(world, org)).map((d) => toValue(d)),
    terrainAt: ([x, y]) => {
      const at = tile(x, y, 'terrainAt')
      if (!context.explored(at.x, at.y)) return null
      return TERRAIN_NAMES.get(terrainAt(terrain, at.x, at.y)) ?? null
    },
    distance: ([a, b]) => wrapDistance(terrain.size, spot(a, 'distance'), spot(b, 'distance')),
  }

  /** Asks for an order for `me`, checked exactly as one from the UI. */
  const request = (kind: string, input: Record<string, unknown>): Value => {
    const order: OrderRequest = { kind, ...forMe, ...input }
    const orderKind = kinds[kind]
    if (!orderKind) throw new Error(`no order kind ${kind} for the script action`)
    const reason = orderKind.validate(world, sender, order, terrain)
    if (reason !== undefined) return reason
    requests.push(order)
    return null
  }

  let api: readonly ScriptBinding[]
  let me: Value
  let forMe: Record<string, string>
  let actions: Record<string, (args: Value[]) => Value>
  if (context.armyId !== undefined) {
    const army = world.armies.find((a) => a.id === context.armyId)
    if (!army) throw new Error(`no army ${context.armyId} to run a script for`)
    api = ARMY_SCRIPT_API
    forMe = { armyId: army.id }
    const members = army.memberIds.flatMap((id) => {
      const r = world.residents.find((x) => x.id === id)
      return r ? [{ ...r, script: undefined, age: ageInYears(r, world.tick) }] : []
    })
    // The army's own script state is `memory`, not part of `me`.
    me = toValue({ ...army, script: undefined, members })
    actions = {
      walkTo: ([x, y]) => request('armyWalkTo', { x: plain(x), y: plain(y) }),
      guard: ([x, y]) => request('armyGuard', { x: plain(x), y: plain(y) }),
      attack: ([targetId]) => request('armyAttack', { targetId: plain(targetId) }),
      follow: ([targetId]) => request('armyFollow', { targetId: plain(targetId) }),
      stop: () => request('armyStop', {}),
    }
  } else {
    const resident = world.residents.find((r) => r.id === context.residentId)
    if (!resident) throw new Error(`no resident ${context.residentId} to run a script for`)
    api = SCRIPT_API
    forMe = { residentId: resident.id }
    // The script's own state is `memory`, not part of `me`.
    me = toValue({ ...resident, script: undefined, age: ageInYears(resident, world.tick) })
    actions = residentActions(request, resident)
  }

  const values: Record<string, Value> = {
    me,
    memory: context.memory,
    tick: world.tick,
    mapSize: terrain.size,
  }

  const globals: Record<string, Value> = {}
  for (const binding of api) {
    if (binding.is === 'value') {
      globals[binding.name] = values[binding.name]!
      continue
    }
    const call = (binding.is === 'query' ? queries : actions)[binding.name]
    if (!call) throw new Error(`the script binding ${binding.name} is not implemented`)
    globals[binding.name] = new NativeFunction(binding.name, call, binding.cost)
  }
  return { globals, requests }
}

/** The actions of a resident's script (`SCRIPT_API`), each asking for the order of its name. */
function residentActions(
  request: (kind: string, input: Record<string, unknown>) => Value,
  resident: { x: number; y: number },
): Record<string, (args: Value[]) => Value> {
  return {
    walkTo: ([x, y]) => request('walkTo', { x: plain(x), y: plain(y) }),
    drive: ([carriageId, x, y]) =>
      request('drive', { carriageId: plain(carriageId), x: plain(x), y: plain(y) }),
    haul: ([carriageId, x, y, goods, returnGoods, keepFood]) =>
      request('haul', {
        carriageId: plain(carriageId),
        x: plain(x),
        y: plain(y),
        goods: plain(goods),
        returnGoods: plain(returnGoods ?? []),
        keepFood: plain(keepFood ?? HAUL_KEEP_FOOD),
      }),
    stop: () => request('stop', {}),
    pickUp: ([spot, goods]) => request('pickUp', { spot: plain(spot), goods: plain(goods) }),
    drop: ([spot, goods]) => request('drop', { spot: plain(spot), goods: plain(goods) }),
    build: ([building]) => request('build', { building: plain(building) }),
    tearDown: ([buildingId]) => request('tearDown', { buildingId: plain(buildingId) }),
    workAt: ([makes]) => request('workAt', makes == null ? {} : { makes: plain(makes) }),
    pair: ([partnerId]) => request('pair', { partnerId: plain(partnerId) }),
    attack: ([targetId]) => request('attack', { targetId: plain(targetId) }),
    climb: ([wallId]) => request('climb', { wallId: plain(wallId) }),
    pay: ([contractId, weeks]) =>
      request('pay', { contractId: plain(contractId), weeks: plain(weeks) }),
    buyCity: ([cityId]) => request('buyCity', { cityId: plain(cityId) }),
    buy: ([good, units, carriageId, cityId]) =>
      request('buy', {
        good: plain(good),
        units: plain(units),
        carriageId: plain(carriageId ?? null),
        ...(cityId === undefined || cityId === null ? {} : { cityId: plain(cityId) }),
      }),
    sell: ([good, units, carriageId, cityId]) =>
      request('sell', {
        good: plain(good),
        units: plain(units),
        carriageId: plain(carriageId ?? null),
        ...(cityId === undefined || cityId === null ? {} : { cityId: plain(cityId) }),
      }),
    handIn: ([good, units, toCityId, carriageId]) =>
      request('handIn', {
        good: plain(good),
        units: plain(units),
        toCityId: plain(toCityId),
        carriageId: plain(carriageId ?? null),
      }),
    buyOff: ([directiveId, carriageId]) =>
      request('buyOff', {
        directiveId: plain(directiveId),
        carriageId: plain(carriageId ?? null),
      }),
    roadLine: ([x, y]) =>
      request('roadLine', {
        from: { x: resident.x, y: resident.y },
        to: { x: plain(x), y: plain(y) },
      }),
  }
}

/**
 * Invariant (ADR 0004): a script can request nothing an order couldn't. Each request a resident's
 * script made is one of the script order kinds, for that resident, and passes that order kind's
 * own check against the world as it is.
 */
export function scriptRequestsSound(
  world: WorldState,
  terrain: TerrainMap,
  sender: OrderSender,
  residentId: string,
  requests: readonly OrderRequest[],
  kinds: Record<string, OrderKind> = orderKinds,
): InvariantViolation[] {
  return requestsSound(world, terrain, sender, residentId, requests, kinds, 'resident')
}

/** The same invariant for an army's script: each request is an army action's order for it. */
export function armyScriptRequestsSound(
  world: WorldState,
  terrain: TerrainMap,
  sender: OrderSender,
  armyId: string,
  requests: readonly OrderRequest[],
  kinds: Record<string, OrderKind> = orderKinds,
): InvariantViolation[] {
  return requestsSound(world, terrain, sender, armyId, requests, kinds, 'army')
}

function requestsSound(
  world: WorldState,
  terrain: TerrainMap,
  sender: OrderSender,
  id: string,
  requests: readonly OrderRequest[],
  kinds: Record<string, OrderKind>,
  who: 'resident' | 'army',
): InvariantViolation[] {
  const allowed = who === 'army' ? ARMY_SCRIPT_ORDER_KINDS : SCRIPT_ORDER_KINDS
  const field = who === 'army' ? 'armyId' : 'residentId'
  const out: InvariantViolation[] = []
  for (const order of requests) {
    const fail = (message: string) =>
      out.push({
        invariant: 'script-requests-as-orders',
        message: `${id}'s script requested ${order.kind}: ${message}`,
        entityIds: [id],
      })
    const kind = kinds[order.kind]
    if (!allowed.includes(order.kind) || !kind) {
      fail(`not an order ${who === 'army' ? 'an army' : 'a resident'} can get`)
    } else if (order[field] !== id) fail(`for another ${who}, ${String(order[field])}`)
    else {
      const reason = kind.validate(world, sender, order, terrain)
      if (reason !== undefined) fail(reason)
    }
  }
  return out
}

/**
 * A copy of plain world data as a script value, frozen so the script can't change it (`me` and
 * what queries answer are the world as seen, not the world itself).
 */
function toValue(data: unknown): Value {
  if (data === null || data === undefined) return null
  if (typeof data === 'number' || typeof data === 'string' || typeof data === 'boolean') {
    return data
  }
  if (Array.isArray(data)) return Object.freeze(data.map(toValue)) as Value[]
  if (typeof data === 'object') {
    const out = Object.create(null) as ScriptObject
    for (const [key, item] of Object.entries(data)) {
      if (item !== undefined) out[key] = toValue(item)
    }
    return Object.freeze(out)
  }
  return null
}

/** A script value as plain data for an order request; functions can't be sent. */
function plain(value: Value | undefined): unknown {
  if (value === undefined || value === null) return undefined
  if (value instanceof NativeFunction || value instanceof ScriptFunction) {
    throw new ScriptRuntimeError('A function can’t be passed to an action')
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(plain)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = plain(item)
  return out
}

function tile(x: Value | undefined, y: Value | undefined, name: string): { x: number; y: number } {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new ScriptRuntimeError(`"${name}" needs a tile: two whole numbers x and y`)
  }
  return { x: x as number, y: y as number }
}

/** Something with `x` and `y`, such as a resident or a building. */
function spot(value: Value | undefined, name: string): { x: number; y: number } {
  const v = value as Record<string, Value> | undefined
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ScriptRuntimeError(`"${name}" needs things with x and y`)
  }
  return tile(v.x, v.y, name)
}
