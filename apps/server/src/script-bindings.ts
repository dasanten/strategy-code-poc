import { NativeFunction, ScriptRuntimeError, type ScriptObject, type Value } from '@csp/lang'
import {
  ARMY_SCRIPT_API,
  GOODS,
  HAUL_KEEP_FOOD,
  ROAD_LINE_MAX_TILES,
  RECIPES,
  SCRIPT_ACTION_VALUE_MAX,
  SCRIPT_API,
  SCRIPT_VIEWS,
  Terrain,
  DOING_MAX_LENGTH,
  ageInYears,
  occupationTicksLeft,
  breedingPair,
  buildingAt,
  teacherAt,
  traineesOf,
  buildingRealm,
  constructionAt,
  lineTile,
  roadLine,
  crewTile,
  directivesFor,
  materialsNeeded,
  organizationLabel,
  pileAt,
  queueView,
  terrainAt,
  unitsThatFit,
  passengersOf,
  workplaceGood,
  wrapDistance,
  type Good,
  type Building,
  type BuildLine,
  type LineTile,
  type OrderRequest,
  type Queue,
  type Resident,
  type Struck,
  type ResourceNode,
  type RunningScript,
  type ScriptBinding,
  type ScriptParamType,
  type ScriptParamValue,
  type ScriptType,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { orderKindOf, orderKinds, type OrderKind, type OrderSender } from './orders.js'
import { hash, mulberry32 } from './residents.js'
import { sightOf } from './sight.js'
import { lastSeenOutOfSight } from './last-seen.js'
import { plainValue, type PlainValue } from './plain-value.js'
import { paramTarget } from './script-params.js'
import { realmOf } from './starting-city.js'
import { walkTime } from './walk-time.js'

/** Re-exported for the callers that reckon walks like scripts do. */
export { walkTime } from './walk-time.js'
import { worldIndex } from './world-index.js'

/**
 * The game API bound for a running script (`CONTEXT.md`: Script, Memory, Step budget; ADR 0002).
 * `SCRIPT_API` in `@csp/shared` lists the names and their step costs; this gives them their
 * meaning for one resident in one tick.
 *
 * Queries read only what the Player sees and has explored, and every value a script gets is built
 * from its script view (ADR 0011), so it holds exactly the view's fields. Actions build the very order request
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
  /**
   * The script's `param` lines with the id or number picked for each (`paramValues`); `params`
   * holds nothing without it.
   */
  params?: readonly {
    name: string
    type: ScriptParamType
    default?: number
    value?: ScriptParamValue
  }[]
}

export interface ScriptBindings {
  /** The globals to run the script with (`RunOptions.globals`). */
  globals: Record<string, Value>
  /** The order requests the script's actions asked for and that were accepted, in order. */
  requests: OrderRequest[]
  /** Whether the script called `end()`: once its requests are applied, it ends. */
  ended(): boolean
  /** The reason it gave `end(reason)`, cut like `doing`'s text; null without one. */
  endReason(): string | null
  /**
   * Whether the script called `wait()` (`CONTEXT.md`: Running a script, Waiting): once its
   * requests are applied, it waits on the resident's order, if they have one.
   */
  waited(): boolean
  /** The lines it gave `log(text)`, in order, cut like `doing`'s text (`CONTEXT.md`: Script log). */
  logged: string[]
}

/**
 * The order kinds a resident's script can request: one per action in `SCRIPT_API`, but `doing`,
 * `log`, `end` and `wait`, which ask for none.
 */
export const SCRIPT_ORDER_KINDS: readonly string[] = SCRIPT_API.filter(
  (b) => b.is === 'action' && !['doing', 'log', 'end', 'wait'].includes(b.name),
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
  let endReason: string | null = null
  let waited = false
  const logged: string[] = []

  let seen: readonly SeenEntity[] | undefined
  const untagged = ({ is: _, ...rest }: SeenEntity) => rest
  const seenOf = (is: SeenEntity['is'], add?: (id: string) => object | undefined) => {
    seen ??= context.seen()
    return seen
      .filter((e) => e.is === is)
      .map(untagged)
      .map((rest) => asView(world, { ...rest, ...add?.(rest.id) }))
  }
  // Whose script it is: the Player's realm, or the NPC city running the game's defaults.
  const side = sender.npcCityId ?? realmOf(world, sender.userId)?.id
  const own = (r: Resident) =>
    side !== undefined &&
    (sender.npcCityId === undefined ? r.owner === side : r.owner === null && r.cityId === side)
  let sees: ((at: { x: number; y: number }) => boolean) | undefined
  const inSight = (at: { x: number; y: number }) =>
    side !== undefined && (sees ??= sightOf(world, terrain.size, side))(at)
  // A building of one of the side's own cities, or an outpost storage of its realm, which it
  // knows of in sight or not.
  const ownBuilding = (b: Building) =>
    side !== undefined &&
    (sender.npcCityId !== undefined ? b.cityId === side : buildingRealm(world, b) === side)
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
    return asView(world, { ...rest, script: running })
  }
  // A building as `building(id)` gives it: one of the side's own as it is, another's as the
  // Player sees it, its stock only when they see inside (`CONTEXT.md`: Seeing inside a storage).
  // Who teaches what and who trains at a training ground (`CONTEXT.md`: Teacher, Trainee), from
  // residents' orders.
  const teachingAt = (id: string) => {
    const ground = world.buildings.find((b) => b.id === id)
    if (ground?.kind !== 'trainingGround') return undefined
    const teacher = teacherAt(ground, world.residents, terrain.size)
    const o = teacher?.order
    const trainees = traineesOf(ground, world.residents, terrain.size).map((r) => r.id)
    return teacher && o?.kind === 'teach'
      ? { teacher: teacher.id, subject: o.subject, trainees }
      : { trainees }
  }
  const asSeenBuilding = (b: Building) => {
    if (ownBuilding(b)) return b
    seen ??= context.seen()
    const shown = seen.find((e) => e.is === 'building' && e.id === b.id)
    return shown ? { ...untagged(shown), ...teachingAt(b.id) } : null
  }
  // The building as the Player remembers it (`CONTEXT.md`: Last seen); an NPC city has no memory.
  const lastSaw = (b: Building) =>
    sender.npcCityId !== undefined
      ? undefined
      : world.lastSeen[sender.userId]?.find((e) => e.id === b.id && e.is === 'building')
  // Who occupies a seen city's town hall and the ticks left (`CONTEXT.md`: Occupying a town
  // hall), only with the hall in sight, as the Player sees it.
  const occupationSeen = (id: string) => {
    const c = seen?.find((e) => e.is === 'city' && e.id === id)
    if (c?.is !== 'city' || !c.occupation) return { occupation: null }
    const ticksLeft = occupationTicksLeft(world, c)
    return { occupation: { realmId: c.occupation.realmId, ticksLeft } }
  }
  let nodes: ResourceNode[] | undefined
  const exploredNodes = () => (nodes ??= world.nodes.filter((n) => context.explored(n.x, n.y)))

  // What each query answers, as the server's data; the script gets it built from the view the
  // query returns (`viewValue`).
  const queries: Record<string, (args: Value[]) => unknown> = {
    residents: () => seenOf('resident', ownMemory),
    buildings: () => seenOf('building', teachingAt),
    cities: () => seenOf('city', occupationSeen),
    horses: () => seenOf('horse'),
    carriages: () => seenOf('carriage'),
    piles: () => seenOf('pile'),
    nodes: exploredNodes,
    // A Player's memory, apart from what is in sight (`CONTEXT.md`: Last seen); an NPC city has none.
    lastSeen: () =>
      sender.npcCityId !== undefined ? [] : lastSeenOutOfSight(world, terrain.size, sender.userId),
    directives: () => directivesFor(world, (org) => organizationLabel(world, org)),
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
      const b = typeof id === 'string' ? worldIndex(world).buildingById(id) : undefined
      return b ? asSeenBuilding(b) : null
    },
    buildingAt: ([x, y]) => {
      const at = tile(x, y, 'buildingAt')
      const b = worldIndex(world).buildingAt(at.x, at.y, terrain.size)
      return b && (ownBuilding(b) || inSight(at)) ? asSeenBuilding(b) : null
    },
    pileAt: ([x, y]) => {
      const at = tile(x, y, 'pileAt')
      return inSight(at) ? pileAt(world, at.x, at.y)?.goods : null
    },
    outputOf: ([building]) => {
      const id = (building as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? worldIndex(world).buildingById(id) : undefined
      if (!b || !(ownBuilding(b) || inSight(b) || lastSaw(b))) return []
      const recipes = RECIPES[b.kind]
      const goods = recipes
        ? [...new Set(recipes.flatMap((r) => Object.keys(r.output)))]
        : [workplaceGood(world, b)].filter((g) => g !== undefined)
      return goods
    },
    materialsNeeded: ([site]) => {
      const id = (site as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? worldIndex(world).buildingById(id) : undefined
      if (!b?.site || !(ownBuilding(b) || inSight(b))) return []
      return Object.entries(materialsNeeded(b)).map(([good, units]) => ({ good, units }))
    },
    terrainAt: ([x, y]) => {
      const at = tile(x, y, 'terrainAt')
      if (!context.explored(at.x, at.y)) return null
      return TERRAIN_NAMES.get(terrainAt(terrain, at.x, at.y)) ?? null
    },
    distance: ([a, b]) => wrapDistance(terrain.size, spot(a, 'distance'), spot(b, 'distance')),
    // A tile out of sight is still to build, with its site where it is one of the side's own.
    lineTiles: ([line, from]) => {
      const { building, from: start, to } = lineOf(line)
      const tiles = roadLine(start, to, terrain.size)
      if (tiles.length > ROAD_LINE_MAX_TILES) {
        throw new ScriptRuntimeError(`"lineTiles" covers at most ${ROAD_LINE_MAX_TILES} tiles`)
      }
      const out = tiles.flatMap(([x, y]): LineTile[] => {
        if (inSight({ x, y }))
          return [lineTile(world, building, x, y, terrain)].filter((t) => t !== undefined)
        const site = constructionAt(world, x, y, building)
        const ownSite = site?.site && site.kind === building && ownBuilding(site)
        return [{ x, y, siteId: ownSite ? site.id : null }]
      })
      if (from == null) return out
      const near = spot(from, 'lineTiles')
      const away = (t: LineTile) => wrapDistance(terrain.size, near, t)
      return out.sort((a, b) => away(a) - away(b))
    },
  }

  /** Asks for an order for `me`, checked exactly as one from the UI. */
  const request = (kind: string, input: Record<string, unknown>): Value => {
    const order: OrderRequest = { kind, ...forMe, ...input }
    const orderKind = orderKindOf(kinds, kind)
    if (!orderKind) throw new Error(`no order kind ${kind} for the script action`)
    const reason = orderKind.validate(world, sender, order, terrain)
    if (reason !== undefined) return reason
    requests.push(order)
    return null
  }

  let api: readonly ScriptBinding[]
  let me: object
  let forMe: Record<string, string>
  let actions: Record<string, (args: Value[]) => Value>
  if (context.armyId !== undefined) {
    const army = world.armies.find((a) => a.id === context.armyId)
    if (!army) throw new Error(`no army ${context.armyId} to run a script for`)
    api = ARMY_SCRIPT_API
    forMe = { armyId: army.id }
    const members = army.memberIds.flatMap((id) => {
      const r = worldIndex(world).residentById(id)
      if (!r) return []
      const defenceScriptId = r.owner === side ? r.defenceScriptId : undefined
      return [{ ...r, script: undefined, defenceScriptId, age: ageInYears(r, world.tick) }]
    })
    const struck = lastStruck(members)
    me = {
      ...army,
      members: members.map((m) => asView(world, m)),
      ...(struck ? struckView(world, struck) : {}),
    }
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
    // The defence script picked is its owner's to see (`CONTEXT.md`: Defence script).
    const defenceScriptId = resident.owner === side ? resident.defenceScriptId : undefined
    const age = ageInYears(resident, world.tick)
    me = asView(world, { ...resident, script: undefined, defenceScriptId, age })
    actions = residentActions(request, resident)
    // At the training ground on my tile; the order checks it is one.
    actions.teach = ([subject]) =>
      request('teach', {
        buildingId: buildingAt(world, resident.x, resident.y, terrain.size)?.id ?? null,
        subject: plain(subject),
      })
    actions.train = () =>
      request('train', {
        buildingId: buildingAt(world, resident.x, resident.y, terrain.size)?.id ?? null,
      })
    actions.doing = ([text]) => {
      const doing = doingText(text)
      if (doing === null) delete context.memory.doing
      else context.memory.doing = doing
      return null
    }
    actions.end = ([reason]) => {
      endReason = shortText(reason, 'end')
      ended = true
      return null
    }
    actions.wait = () => {
      waited = true
      return null
    }
    actions.log = ([text]) => {
      const line = shortText(text, 'log')
      if (line !== null) logged.push(line)
      return null
    }
    queries.fits = ([good]) => {
      if (!(GOODS as readonly unknown[]).includes(good)) {
        throw new ScriptRuntimeError(`"fits" needs a good, not ${String(good)}`)
      }
      return unitsThatFit(resident, good as Good, world.tick)
    }
    queries.breedingPair = ([stable]) => {
      const id = (stable as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? worldIndex(world).buildingById(id) : undefined
      if (!b || b.kind !== 'stable' || side === undefined || !(ownBuilding(b) || inSight(b)))
        return null
      const owner = sender.npcCityId !== undefined ? { cityId: side } : { realmId: side }
      const pair = breedingPair(world, b, owner, resident)
      return pair ? pair.map((h) => h.id) : null
    }
    const time = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      walkTime(world, terrain, context.explored, resident, a, b)
    queries.walkTime = ([a, b]) => time(spot(a, 'walkTime'), spot(b, 'walkTime'))
    queries.crewTile = ([building]) => {
      const id = (building as Record<string, Value> | null)?.id
      const b = typeof id === 'string' ? world.buildings.find((x) => x.id === id) : undefined
      if (!b || !(ownBuilding(b) || inSight(b))) return null
      return crewTile(world, b, resident, own, terrain.size)
    }
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
      // A Trade Org city's warehouses hold its goods (`CONTEXT.md`: Warehouse): its residents
      // fetch materials and Food there too, when they name the goods.
      const kinds =
        wanted && sender.npcCityId !== undefined ? ['storage', 'warehouse'] : ['storage']
      const storages = world.buildings.filter(
        (b) => kinds.includes(b.kind) && !b.site && ownBuilding(b) && holds(b),
      )
      if (from !== undefined && from !== null) {
        const at = spot(from, 'storages')
        const by = new Map(storages.map((b) => [b, time(at, b)]))
        storages.sort((a, b) => by.get(a)! - by.get(b)!)
      }
      return storages
    }
  }

  // A building a param names: one of the side's own as it is; another's (a workplace or site
  // anyone may work) as the Player sees it, else as they last saw it.
  // The view takes only its own fields, so the memory's tag and `seenAt` stay out.
  const paramBuilding = (b: Building) => asSeenBuilding(b) ?? lastSaw(b)

  // Each param as what it names while that is still the side's and fits its type, or the
  // number typed for a number param, or its default while none is; else null.
  const params = Object.create(null) as ScriptObject
  for (const p of context.params ?? []) {
    if (p.type === 'number') {
      params[p.name] = typeof p.value === 'number' ? p.value : (p.default ?? null)
      continue
    }
    const id = typeof p.value === 'string' ? p.value : undefined
    const target = id === undefined ? undefined : paramTarget(world, side, p.type, id)
    const carriage = target?.is === 'carriage' ? target.carriage : undefined
    params[p.name] =
      target?.is === 'building'
        ? viewValue(paramBuilding(target.building), { view: 'building' })
        : viewValue(
            carriage && {
              ...carriage,
              passengerIds: passengersOf(world, carriage).map((r) => r.id),
            },
            { view: 'carriage' },
          )
  }

  const values: Record<string, Value> = {
    me: viewValue(me, api.find((b) => b.name === 'me')!.returns),
    memory: context.memory,
    params: Object.freeze(params),
    tick: world.tick,
    mapSize: terrain.size,
    random: tickRandom(world),
  }
  const helpers = scriptHelpers(values.random as number)

  const globals: Record<string, Value> = {}
  for (const binding of api) {
    if (binding.is === 'value') {
      globals[binding.name] = values[binding.name]!
      continue
    }
    // A helper answers with what it was given, as it is, not through a script view.
    const helper = helpers[binding.name]
    if (helper) {
      globals[binding.name] = new NativeFunction(binding.name, helper, binding.cost)
      continue
    }
    const call = (binding.is === 'query' ? queries : actions)[binding.name]
    if (!call) throw new Error(`the script binding ${binding.name} is not implemented`)
    const answer =
      binding.is === 'query'
        ? (args: Value[]) => viewValue(call(args), binding.returns)
        : (call as (args: Value[]) => Value)
    globals[binding.name] = new NativeFunction(binding.name, answer, binding.cost)
  }
  return {
    globals,
    requests,
    ended: () => ended,
    endReason: () => endReason,
    waited: () => waited,
    logged,
  }
}

/**
 * What `doing(text)` keeps as `memory.doing` (`CONTEXT.md`: Doing): the text trimmed and cut to
 * `DOING_MAX_LENGTH` characters, or null, as for empty text, to give the derived line back.
 */
export function doingText(text: Value | undefined): string | null {
  return shortText(text, 'doing')
}

/** A short text a script gives `call`: trimmed and cut to `DOING_MAX_LENGTH`; empty is null. */
function shortText(text: Value | undefined, call: string): string | null {
  if (text === undefined || text === null) return null
  if (typeof text !== 'string') throw new ScriptRuntimeError(`"${call}" needs a text or null`)
  return text.trim().slice(0, DOING_MAX_LENGTH) || null
}

/**
 * The helpers of the game API (`CONTEXT.md`: Default script), which work only on what they are
 * given: `floor(n)`, and `pickRandom(list)`, the item at `random` of the way along the list.
 */
export function scriptHelpers(random: number): Record<string, (args: Value[]) => Value> {
  return {
    floor: ([n]) => {
      if (typeof n !== 'number') throw new ScriptRuntimeError('"floor" needs a number')
      return Math.floor(n)
    },
    pickRandom: ([items]) => {
      if (!Array.isArray(items)) throw new ScriptRuntimeError('"pickRandom" needs a list')
      return items.length === 0 ? null : items[Math.floor(random * items.length)]!
    },
  }
}

/** The `random` value of a tick: drawn from the world's seed, the same for every script. */
export function tickRandom(world: Pick<WorldState, 'seed' | 'tick'>): number {
  return mulberry32(hash(`${world.seed}:${world.tick}:random`))()
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
    unhitch: ([carriage]) =>
      request('unhitch', { carriageId: carriage == null ? null : placeId(carriage) }),
    board: ([carriageId]) => request('board', { carriageId: plain(carriageId) }),
    getOff: ([x, y]) =>
      request('getOff', (x ?? y ?? null) === null ? {} : { x: plain(x), y: plain(y) }),
    stop: () => request('stop', {}),
    pickUp: ([spot, goods]) => request('pickUp', { spot: plain(spot), goods: plain(goods) }),
    drop: ([spot, goods]) => request('drop', { spot: plain(spot), goods: plain(goods) }),
    store: ([goods, to, ownFood]) =>
      request('store', {
        goods: plain(goods),
        ...(to == null ? {} : { to: placeId(to) }),
        ...(ownFood == null ? {} : { ownFood: plain(ownFood) }),
      }),
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
    renameHorse: ([horseId, name]) =>
      request('renameHorse', { horseId: plain(horseId), name: plain(name) }),
    claimHorses: () => request('claimHorses', {}),
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
    const kind = orderKindOf(kinds, order.kind)
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
 * A resident as its script view shows it: its queue as `queueView`, not its steps, and who last
 * struck them as `struckBy` and `struckAt`, while that attacker is still there (`CONTEXT.md`:
 * Combat, Under attack). Anything else passes as it is.
 */
function asView(world: WorldState, r: object): object {
  const { queue, struck, defenceScriptId } = r as {
    queue?: Queue
    struck?: Struck
    defenceScriptId?: number
  }
  return {
    ...r,
    ...(queue ? { queue: queueView(queue) } : {}),
    ...(struck ? struckView(world, struck) : {}),
    ...(defenceScriptId !== undefined ? { defenceScript: defenceScriptId } : {}),
  }
}

/** `struckBy` and `struckAt` for who last struck a resident, or nothing once they are gone. */
function struckView(world: WorldState, struck: Struck): object {
  return world.residents.some((x) => x.id === struck.by)
    ? { struckBy: struck.by, struckAt: struck.tick }
    : {}
}

/** Who last struck any of `members`: the `struck` with the latest tick, if any was. */
function lastStruck(members: readonly Resident[]): Struck | undefined {
  let last: Struck | undefined
  for (const m of members) if (m.struck && (!last || m.struck.tick > last.tick)) last = m.struck
  return last
}

/**
 * Plain world data as a script value of `type`, built from its script view (ADR 0011): an object
 * holds exactly its view's fields, each `null` that the data doesn't hold, so no other field of
 * the server's reaches a script. A value of the wrong kind for its type is `null`. Frozen, so the
 * script can't change it (`me` and what queries answer are the world as seen, not the world).
 */
export function viewValue(data: unknown, type: ScriptType): Value {
  if (data === null || data === undefined) return null
  if (type === 'any') return toValue(data)
  if (typeof type === 'string') return typeof data === type ? (data as Value) : null
  if ('list' in type) {
    return Array.isArray(data)
      ? (Object.freeze(data.map((d) => viewValue(d, type.list))) as Value[])
      : null
  }
  if (typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const out = Object.create(null) as ScriptObject
  for (const f of SCRIPT_VIEWS[type.view].fields) out[f.name] = viewValue(record[f.name], f.type)
  return Object.freeze(out)
}

/** A copy of plain data as a script value, frozen; for what a view leaves open (`any`). */
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

/**
 * A script value as plain data for an order request, within `SCRIPT_ACTION_VALUE_MAX` characters
 * of JSON; functions, values that hold themselves and larger values can't be sent.
 */
function plain(value: Value | undefined): PlainValue | undefined {
  if (value === undefined || value === null) return undefined
  const result = plainValue(value, SCRIPT_ACTION_VALUE_MAX)
  if (result.ok) return result.value
  switch (result.why) {
    case 'function':
      throw new ScriptRuntimeError('A function can’t be passed to an action')
    case 'cycle':
      throw new ScriptRuntimeError('A value that holds itself can’t be passed to an action')
    case 'size':
      throw new ScriptRuntimeError(
        `A value passed to an action can have at most ${SCRIPT_ACTION_VALUE_MAX} characters`,
      )
  }
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

/** A Build line, as the Build line task keeps it in `memory.line` (`CONTEXT.md`: Build line). */
function lineOf(value: Value | undefined): BuildLine {
  const v = value as Record<string, Value> | undefined
  const building = typeof v === 'object' && v !== null && !Array.isArray(v) ? v.building : undefined
  if (building !== 'road' && building !== 'wall') {
    throw new ScriptRuntimeError('"lineTiles" needs a line: {building: "road" or "wall", from, to}')
  }
  return { building, from: spot(v!.from, 'lineTiles'), to: spot(v!.to, 'lineTiles') }
}

/** Something with `x` and `y`, such as a resident or a building. */
function spot(value: Value | undefined, name: string): { x: number; y: number } {
  const v = value as Record<string, Value> | undefined
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ScriptRuntimeError(`"${name}" needs things with x and y`)
  }
  return tile(v.x, v.y, name)
}
