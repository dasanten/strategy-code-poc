import {
  NativeFunction,
  ScriptFunction,
  ScriptRuntimeError,
  type ScriptObject,
  type Value,
} from '@csp/lang'
import {
  ARMY_SCRIPT_API,
  GOODS,
  HAUL_KEEP_FOOD,
  RECIPES,
  SCRIPT_API,
  Terrain,
  DIAGONAL_STEP,
  DOING_MAX_LENGTH,
  ageInYears,
  directivesFor,
  materialsNeeded,
  organizationLabel,
  pileAt,
  queueView,
  terrainAt,
  unitsThatFit,
  walkSpeed,
  rideSpeed,
  horseRidden,
  workplaceGood,
  wrap,
  wrapDelta,
  wrapDistance,
  type Good,
  type Building,
  type OrderRequest,
  type Queue,
  type Resident,
  type ResourceNode,
  type RunningScript,
  type ScriptBinding,
  type ScriptParamType,
  type ScriptParamValue,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { orderKinds, type OrderKind, type OrderSender } from './orders.js'
import { hash, mulberry32 } from './residents.js'
import { sightOf } from './sight.js'
import { lastSeenOutOfSight } from './last-seen.js'
import { paramTarget } from './script-params.js'
import { realmOf } from './starting-city.js'

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
  /**
   * Whether the Player sees a spot (`sightOf`), shared by every run of theirs this tick; worked
   * out for this run alone without it.
   */
  sees?: (at: { x: number; y: number }) => boolean
  /** Whether the Player has explored a tile (`ExploredTerrain.isExplored`). */
  explored: (x: number, y: number) => boolean
  /** The order kinds actions go through; the game's own by default. */
  kinds?: Record<string, OrderKind>
  /**
   * The script's `param` lines with the id or number picked for each (`paramValues`); `params`
   * holds nothing without it.
   */
  params?: readonly { name: string; type: ScriptParamType; value?: ScriptParamValue }[]
}

export interface ScriptBindings {
  /** The globals to run the script with (`RunOptions.globals`). */
  globals: Record<string, Value>
  /** The order requests the script's actions asked for and that were accepted, in order. */
  requests: OrderRequest[]
  /** Whether the script called `end()`: once its requests are applied, it ends. */
  ended(): boolean
}

/**
 * The order kinds a resident's script can request: one per action in `SCRIPT_API`, but `doing`
 * and `end`, which ask for none.
 */
export const SCRIPT_ORDER_KINDS: readonly string[] = SCRIPT_API.filter(
  (b) => b.is === 'action' && b.name !== 'doing' && b.name !== 'end',
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
  let ended = false

  let seen: readonly SeenEntity[] | undefined
  const untagged = ({ is: _, ...rest }: SeenEntity) => rest
  const seenOf = (is: SeenEntity['is'], add?: (id: string) => object | undefined): Value => {
    seen ??= context.seen()
    return seen
      .filter((e) => e.is === is)
      .map(untagged)
      .map((rest) => toValue(withQueueView({ ...rest, ...add?.(rest.id) })))
  }
  // Whose script it is: the Player's realm, or the NPC city running the game's defaults.
  const side = sender.npcCityId ?? realmOf(world, sender.userId)?.id
  const own = (r: Resident) =>
    side !== undefined &&
    (sender.npcCityId === undefined ? r.owner === side : r.owner === null && r.cityId === side)
  let sees: ((at: { x: number; y: number }) => boolean) | undefined
  const inSight = (at: { x: number; y: number }) =>
    side !== undefined && (sees ??= context.sees ?? sightOf(world, terrain.size, side))(at)
  // A building of one of the side's own cities, which it knows of in sight or not.
  const ownBuilding = (b: Building) =>
    side !== undefined &&
    b.cityId !== null &&
    (sender.npcCityId !== undefined
      ? b.cityId === side
      : world.cities.some((c) => c.id === b.cityId && c.realmId === side))
  // A script reads, never changes, the memory of its own Player's residents (`CONTEXT.md`:
  // Memory); other Players' stays hidden.
  let ownScripts: Map<string, RunningScript> | undefined
  const ownMemory = (id: string) => {
    ownScripts ??= new Map(
      world.residents.flatMap((r) => (own(r) && r.script ? [[r.id, r.script] as const] : [])),
    )
    const running = ownScripts.get(id)
    return running && { script: { scriptId: running.scriptId, memory: running.memory } }
  }
  const asSeen = (r: Resident) => {
    const { script, ...rest } = r
    const running = { scriptId: script!.scriptId, memory: script!.memory }
    return toValue(withQueueView({ ...rest, scriptParams: undefined, script: running }))
  }
  let nodes: Value[] | undefined
  const exploredNodes = (): Value => {
    nodes ??= world.nodes
      .filter((n: ResourceNode) => context.explored(n.x, n.y))
      .map((n) => toValue(n))
    return nodes
  }

  const queries: Record<string, (args: Value[]) => Value> = {
    residents: () => seenOf('resident', ownMemory),
    buildings: () => seenOf('building'),
    cities: () => seenOf('city'),
    horses: () => seenOf('horse'),
    carriages: () => seenOf('carriage'),
    piles: () => seenOf('pile'),
    nodes: exploredNodes,
    // A Player's memory, apart from what is in sight (`CONTEXT.md`: Last seen); an NPC city has none.
    lastSeen: () =>
      sender.npcCityId !== undefined
        ? []
        : lastSeenOutOfSight(world, sender.userId).map((e) => toValue(e)),
    directives: () =>
      directivesFor(world, (org) => organizationLabel(world, org)).map((d) => toValue(d)),
    withMemory: ([key, value]) => {
      if (typeof key !== 'string') throw new ScriptRuntimeError('"withMemory" needs a key')
      const wanted = JSON.stringify(plain(value) ?? null)
      return world.residents
        .filter(
          (r) => own(r) && r.script && JSON.stringify(r.script.memory[key] ?? null) === wanted,
        )
        .map(asSeen)
    },
    building: ([id]) => {
      const b = world.buildings.find((x) => x.id === id)
      if (!b) return null
      if (ownBuilding(b)) return toValue(b)
      // Another's as the Player sees it, its stock only when they see inside (`CONTEXT.md`:
      // Seeing inside a storage).
      seen ??= context.seen()
      const shown = seen.find((e) => e.is === 'building' && e.id === b.id)
      return shown ? toValue(untagged(shown)) : null
    },
    pileAt: ([x, y]) => {
      const at = tile(x, y, 'pileAt')
      return inSight(at) ? toValue(pileAt(world, at.x, at.y)?.goods) : null
    },
    outputOf: ([building]) => {
      const id = (building as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? world.buildings.find((x) => x.id === id) : undefined
      if (!b || !(ownBuilding(b) || inSight(b))) return []
      const recipes = RECIPES[b.kind]
      const goods = recipes
        ? [...new Set(recipes.flatMap((r) => Object.keys(r.output)))]
        : [workplaceGood(world, b)].filter((g) => g !== undefined)
      return Object.freeze(goods) as Value[]
    },
    materialsNeeded: ([site]) => {
      const id = (site as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? world.buildings.find((x) => x.id === id) : undefined
      if (!b?.site || !(ownBuilding(b) || inSight(b))) return []
      const need = Object.entries(materialsNeeded(b)).map(([good, units]) => ({ good, units }))
      return Object.freeze(need.map((m) => toValue(m))) as Value[]
    },
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
    me = toValue(
      withQueueView({
        ...resident,
        script: undefined,
        scriptParams: undefined,
        age: ageInYears(resident, world.tick),
      }),
    )
    actions = residentActions(request, resident)
    actions.doing = ([text]) => {
      const doing = doingText(text)
      if (doing === null) delete context.memory.doing
      else context.memory.doing = doing
      return null
    }
    actions.end = () => {
      ended = true
      return null
    }
    queries.fits = ([good]) => {
      if (!(GOODS as readonly unknown[]).includes(good)) {
        throw new ScriptRuntimeError(`"fits" needs a good, not ${String(good)}`)
      }
      return unitsThatFit(resident, good as Good, world.tick)
    }
    const time = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      walkTime(world, terrain, context.explored, resident, a, b)
    queries.walkTime = ([a, b]) => time(spot(a, 'walkTime'), spot(b, 'walkTime'))
    queries.storages = ([from, goods]) => {
      const wanted = goods === undefined || goods === null ? undefined : plain(goods)
      if (
        wanted !== undefined &&
        !(Array.isArray(wanted) && wanted.every((g) => (GOODS as readonly unknown[]).includes(g)))
      ) {
        throw new ScriptRuntimeError('"storages" needs a list of goods')
      }
      const holds = (b: Building) =>
        !wanted || (wanted as Good[]).some((g) => (b.stock?.[g] ?? 0) > 0)
      const storages = world.buildings.filter(
        (b) => b.kind === 'storage' && !b.site && ownBuilding(b) && holds(b),
      )
      if (from !== undefined && from !== null) {
        const at = spot(from, 'storages')
        const by = new Map(storages.map((b) => [b, time(at, b)]))
        storages.sort((a, b) => by.get(a)! - by.get(b)!)
      }
      return Object.freeze(storages.map((b) => toValue(b))) as Value[]
    }
  }

  // Each param as what it names while that is still the side's and fits its type, or the
  // number typed for a number param; else null.
  const params = Object.create(null) as ScriptObject
  for (const p of context.params ?? []) {
    if (p.type === 'number') {
      params[p.name] = typeof p.value === 'number' ? p.value : null
      continue
    }
    const id = typeof p.value === 'string' ? p.value : undefined
    const target = id === undefined ? undefined : paramTarget(world, side, p.type, id)
    params[p.name] = toValue(target?.is === 'building' ? target.building : target?.carriage)
  }

  const values: Record<string, Value> = {
    me,
    memory: context.memory,
    params: Object.freeze(params),
    tick: world.tick,
    mapSize: terrain.size,
    random: tickRandom(world),
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
  return { globals, requests, ended: () => ended }
}

/**
 * What `doing(text)` keeps as `memory.doing` (`CONTEXT.md`: Doing): the text trimmed and cut to
 * `DOING_MAX_LENGTH` characters, or null, as for empty text, to give the derived line back.
 */
export function doingText(text: Value | undefined): string | null {
  if (text === undefined || text === null) return null
  if (typeof text !== 'string') throw new ScriptRuntimeError('"doing" needs a text or null')
  return text.trim().slice(0, DOING_MAX_LENGTH) || null
}

/** The `random` value of a tick: drawn from the world's seed, the same for every script. */
export function tickRandom(world: Pick<WorldState, 'seed' | 'tick'>): number {
  return mulberry32(hash(`${world.seed}:${world.tick}:random`))()
}

/**
 * About how many ticks a resident takes to walk from `a` to `b` (`walkTime`): step by step along
 * the straight way, diagonally where it slants (`CONTEXT.md`: Step), at their pace on each tile's
 * terrain, Plains where they haven't explored. Tiles they can't walk on count at their slowest
 * pace on land; roads and walls are left out. A rider goes at their horse's pace (`CONTEXT.md`:
 * Riding), and at their slowest on foot where it can't go.
 */
export function walkTime(
  world: WorldState,
  terrain: TerrainMap,
  explored: (x: number, y: number) => boolean,
  r: Resident,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const size = terrain.size
  const dx = wrapDelta(a.x, b.x, size)
  const dy = wrapDelta(a.y, b.y, size)
  const alongX = Math.abs(dx) >= Math.abs(dy)
  const long = alongX ? Math.abs(dx) : Math.abs(dy)
  const short = alongX ? Math.abs(dy) : Math.abs(dx)
  const slowest = walkSpeed(r, Terrain.Mountain, world.tick)
  const horse = horseRidden(world, r)
  const pace = (g: number) => (horse ? rideSpeed(r, horse, g) : walkSpeed(r, g, world.tick))
  let ticks = 0
  let x = a.x
  let y = a.y
  for (let i = 0, slanted = 0; i < long; i++) {
    // Each step goes along the longer direction, and diagonally while the steps along the
    // shorter one so far lag behind the straight line.
    const diagonal = (slanted + 0.5) * long <= (i + 1) * short
    if (diagonal) slanted++
    if (alongX || diagonal) x = wrap(x + Math.sign(dx), size)
    if (!alongX || diagonal) y = wrap(y + Math.sign(dy), size)
    const ground = explored(x, y) ? terrainAt(terrain, x, y) : Terrain.Plains
    ticks += (diagonal ? DIAGONAL_STEP : 1) / (pace(ground) || slowest)
  }
  return Math.ceil(ticks)
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
    mount: ([horseId]) => request('mount', { horseId: plain(horseId) }),
    dismount: () => request('dismount', {}),
    stop: () => request('stop', {}),
    pickUp: ([spot, goods]) => request('pickUp', { spot: plain(spot), goods: plain(goods) }),
    drop: ([spot, goods]) => request('drop', { spot: plain(spot), goods: plain(goods) }),
    store: ([goods, to]) =>
      request('store', { goods: plain(goods), ...(to == null ? {} : { to: placeId(to) }) }),
    fetch: ([goods, from]) =>
      request('fetch', { goods: plain(goods), ...(from == null ? {} : { from: placeId(from) }) }),
    build: ([building]) => request('build', { building: plain(building) }),
    tearDown: ([buildingId]) => request('tearDown', { buildingId: plain(buildingId) }),
    workAt: ([makes]) => request('workAt', makes == null ? {} : { makes: plain(makes) }),
    breed: ([stableId, horseIds]) =>
      request('breed', { stableId: plain(stableId), horseIds: plain(horseIds) }),
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
    handOver: ([newLeaderId]) => request('handOver', { newLeaderId: plain(newLeaderId) }),
    rename: ([targetId, name, realmName]) =>
      request('rename', {
        targetId: plain(targetId),
        name: plain(name),
        ...(realmName === undefined || realmName === null ? {} : { realmName: plain(realmName) }),
      }),
    renameCity: ([cityId, name]) =>
      request('renameCity', { cityId: plain(cityId), name: plain(name) }),
    roadLine: ([x, y]) =>
      request('roadLine', {
        from: { x: resident.x, y: resident.y },
        to: { x: plain(x), y: plain(y) },
      }),
    wallLine: ([x, y]) =>
      request('wallLine', {
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
/** A resident's queue as its script view shows it (`queueView`), not its steps. */
function withQueueView(r: object): object {
  const queue = (r as { queue?: Queue }).queue
  return queue ? { ...r, queue: queueView(queue) } : r
}

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

/** A place for `store` and `fetch`: its id, or the id of a thing a script holds, like a building. */
function placeId(value: Value): unknown {
  const v = value as Record<string, Value>
  return typeof v === 'object' && !Array.isArray(v) && 'id' in v ? plain(v.id) : plain(value)
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
