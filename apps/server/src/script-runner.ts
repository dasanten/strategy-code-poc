import {
  NativeFunction,
  ScriptFunction,
  parse,
  run,
  type Program,
  type ScriptObject,
} from '@csp/lang'
import {
  buildAtProblem,
  buildingAt,
  canWork,
  DEFAULT_SCRIPTS,
  commanderOf,
  MAP_SIZE,
  stableAt,
  commands,
  isTask,
  keptPair,
  type Good,
  type Task,
  type TaskMemory,
  SCRIPT_LOG_INTERVAL,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MEMORY_MAX,
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  type BuildingKind,
  type City,
  type OrderRequest,
  type Realm,
  type Resident,
  type RealmEventWhat,
  type RunningScript,
  type ScriptMemory,
  type ScriptRunBy,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { InvariantViolation } from './invariants.js'
import { npcSender, orderedResident } from './order-sender.js'
import { orderKinds, type OrderKind, type OrderSender } from './orders.js'
import {
  armyScriptRequestsSound,
  bindScript,
  scriptRequestsSound,
  type ScriptContext,
} from './script-bindings.js'
import type { RunnableScript } from './scripts.js'
import { paramValues, scriptParamsSound } from './script-params.js'
import { entitiesInSight, sightOf } from './sight.js'
import { realmOf } from './starting-city.js'

/**
 * Running a script as a resident's or an army's order (`CONTEXT.md`: Running a script, Memory,
 * Step budget).
 *
 * The run-script order sets `Resident.script` or `Army.script`. Each tick, before the world
 * steps, every running script's active version runs once with its memory and the game API bound
 * for its resident or army (script-bindings.ts). What it requests is applied as UI orders are: an
 * action sets the resident's or army's built-in order, which carries on over the next ticks while
 * the script keeps running, so the script hands over to it and takes control back by requesting
 * something else. Any other order from the Player ends the script (`OrderQueue`).
 */

/** What running scripts needs from outside the world: the script library and the Players. */
export interface ScriptHost {
  /** The script's Player and active version; undefined once the script is deleted. */
  script(scriptId: number): RunnableScript | undefined
  /** The Player as an order's sender; undefined if there is no such account. */
  sender(userId: number): OrderSender | undefined
  /** Whether the Player has explored a tile. */
  explored(userId: number, x: number, y: number): boolean
  /**
   * The id of the Player's version of a task's default script, for a resident of theirs started
   * on the task without one (`RunningScript.task`); without it such a script ends.
   */
  defaultScript?(userId: number, task: Task): number
}

interface RunScriptRequest extends OrderRequest {
  kind: 'runScript'
  residentId: string
  scriptId: number
}

interface ArmyRunScriptRequest extends OrderRequest {
  kind: 'armyRunScript'
  armyId: string
  scriptId: number
}

/** A reason the sender can't run script `scriptId`, if any. */
function badScript(
  host: Pick<ScriptHost, 'script'>,
  sender: OrderSender,
  scriptId: unknown,
): string | undefined {
  const script = Number.isInteger(scriptId) ? host.script(scriptId as number) : undefined
  if (!script || script.userId !== sender.userId) {
    return 'not one of your scripts with a version that can run'
  }
  return undefined
}

/**
 * The run-script order: one of the Player's residents runs one of the Player's scripts, from a
 * fresh memory. It ends whatever the resident was doing.
 */
export function runScriptOrder(host: Pick<ScriptHost, 'script'>): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<RunScriptRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      return badScript(host, sender, o.scriptId)
    },
    apply(world, _sender, order) {
      const { residentId, scriptId } = order as RunScriptRequest
      const r = world.residents.find((x) => x.id === residentId)
      if (!r) return
      r.order = null
      r.script = { scriptId, memory: {} }
    },
  }
}

/** Where a task order finds the Player's version of a task's default script. */
export interface DefaultScriptHost {
  /** The id of the Player's version of the task's default script, made if they have none. */
  defaultScript(userId: number, task: Task): number
}

interface WorkTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'work'
  residentId: string
  workplaceId: string
  makes?: Good
}

/** Haul: the haul order's input, to a tile (`CONTEXT.md`: Haul route). */
interface HaulTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'haul'
  residentId: string
  carriageId: string
  x: number
  y: number
  goods: Good[]
  returnGoods?: Good[]
  keepFood: number
}

interface TearDownTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'tearDown'
  residentId: string
  buildingId: string
}

/** Feed the stable: the stable the resident stands in (`CONTEXT.md`: Feeding the stable). */
interface FeedStableTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'feedStable'
  residentId: string
  stableId: string
}

interface BuildTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'build'
  residentId: string
  building: BuildingKind
  /**
   * The north-west tile of the footprint, to walk to first, such as where a node's workplace fits
   * (`nodeCorner`); the resident's own tile without it.
   */
  at?: { x: number; y: number }
}

/** Breed horses: the breed order's input, at the stable the resident stands at. */
interface BreedTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'breed'
  residentId: string
  stableId: string
  horseIds: [string, string]
}

type TaskRequest =
  | WorkTaskRequest
  | BuildTaskRequest
  | HaulTaskRequest
  | TearDownTaskRequest
  | BreedTaskRequest
  | FeedStableTaskRequest

/** The built-in order a task's request is checked as, for the resident. */
function asOrder(o: Partial<TaskRequest>): OrderRequest {
  const residentId = o.residentId
  if (o.task === 'haul') {
    // To a tile only; a supply line to an army stays the bare haul order's.
    const { carriageId, x, y, goods, returnGoods, keepFood } = o
    return { kind: 'haul', residentId, carriageId, x, y, goods, returnGoods, keepFood }
  }
  if (o.task === 'tearDown') return { kind: 'tearDown', residentId, buildingId: o.buildingId }
  if (o.task === 'breed')
    return { kind: 'breed', residentId, stableId: o.stableId, horseIds: o.horseIds }
  if (o.task === 'build') return { kind: 'build', residentId, building: o.building }
  return { kind: 'workAt', residentId, makes: (o as Partial<WorkTaskRequest>).makes }
}

/**
 * The task as the resident takes it up: for Breed horses (`CONTEXT.md`: Breeding), a pair whose
 * breeding the stable keeps comes first (`keptPair`), when the resident can breed it, in place of
 * the two picked.
 */
function withKeptPair(
  world: WorldState,
  o: Partial<TaskRequest>,
  realmId: string | undefined,
): Partial<TaskRequest> {
  if (o.task !== 'breed' || realmId === undefined) return o
  const stable = world.buildings.find((b) => b.id === o.stableId)
  const r = world.residents.find((x) => x.id === o.residentId)
  const kept = stable && r && keptPair(world, stable, { realmId }, r)
  return kept ? { ...o, horseIds: kept } : o
}

/** The memory a task's default script starts from (`TaskMemory`), for resident `r`. */
function taskMemory(order: TaskRequest, r: { x: number; y: number }): ScriptMemory {
  switch (order.task) {
    case 'work': {
      const memory: TaskMemory['work'] = { workplaceId: order.workplaceId }
      if (order.makes !== undefined) memory.makes = order.makes
      return { ...memory }
    }
    case 'build': {
      const at = order.at ? { x: order.at.x, y: order.at.y } : { x: r.x, y: r.y }
      const memory: TaskMemory['build'] = { building: order.building, at }
      return { ...memory }
    }
    case 'haul': {
      const memory: TaskMemory['haul'] = {
        carriageId: order.carriageId,
        from: { x: r.x, y: r.y },
        to: { x: order.x, y: order.y },
        goods: [...order.goods],
        returnGoods: [...(order.returnGoods ?? [])],
        keepFood: order.keepFood,
      }
      return { ...memory }
    }
    case 'tearDown': {
      const memory: TaskMemory['tearDown'] = { buildingId: order.buildingId }
      return { ...memory }
    }
    case 'breed': {
      const memory: TaskMemory['breed'] = {
        stableId: order.stableId,
        horseIds: [...order.horseIds],
      }
      return { ...memory }
    }
    case 'feedStable': {
      const memory: TaskMemory['feedStable'] = { stableId: order.stableId }
      return { ...memory }
    }
  }
}

/**
 * The task order (`CONTEXT.md`: Order, Default script; ADR 0009): one of the Player's residents
 * runs the Player's version of the task's default script, from a memory holding the task's
 * target (`TaskMemory`). It ends whatever the resident was doing. Each task is checked as the
 * built-in order its script starts: Work for the workplace the resident stands on as work-at,
 * Build as the build order on the resident's tile or the one it names, Haul as the haul order to a tile, Tear down as
 * the tear-down order, Breed horses as the breed order. Feed the stable starts no order of its
 * own: the resident stands in the stable and is grown up.
 */
export function taskOrder(host: DefaultScriptHost): OrderKind {
  return {
    validate(world, sender, order, terrain) {
      const o = order as Partial<TaskRequest>
      if (!isTask(o.task)) return 'no such task'
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      if (o.task === 'work') {
        const workplaceId = (o as Partial<WorkTaskRequest>).workplaceId
        if (typeof workplaceId !== 'string' || buildingAt(world, r.x, r.y)?.id !== workplaceId)
          return 'not standing on that workplace'
      }
      if (o.task === 'feedStable') {
        // No order of its own: they store and fetch, which children can't.
        const size = terrain?.size ?? MAP_SIZE
        if (stableAt(world, r.x, r.y, size)?.id !== o.stableId) return 'not standing in that stable'
        return canWork(r, world.tick) ? undefined : 'children can’t store or fetch goods'
      }
      if (o.task === 'build' && o.at !== undefined) {
        // Somewhere else: checked as the build order there, once they have walked to it.
        const at = o.at as Partial<{ x: number; y: number }> | null
        if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y))
          return 'the target must be a tile'
        return buildAtProblem(world, r!, o.building, at as { x: number; y: number }, terrain)
      }
      const built = asOrder(withKeptPair(world, o, realm.id))
      const problem = orderKinds[built.kind]!.validate(world, sender, built, terrain)
      // Working there by a bare work-at order, as the starting residents do, they can still be
      // given the task; already running it there, they can't.
      if (problem === 'already working here' && !r.script) return undefined
      return problem
    },
    apply(world, sender, order) {
      const realmId = realmOf(world, sender.userId)?.id
      const o = withKeptPair(world, order as TaskRequest, realmId) as TaskRequest
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!r) return
      r.order = null
      r.script = { scriptId: host.defaultScript(sender.userId, o.task), memory: taskMemory(o, r) }
    },
  }
}

/**
 * The run-script order for an army: one of the Player's armies runs one of the Player's
 * scripts, from a fresh memory. It ends the army's order, and its members stop what they did
 * for it, as any army order does.
 */
export function armyRunScriptOrder(host: Pick<ScriptHost, 'script'>): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<ArmyRunScriptRequest>
      const realm = realmOf(world, sender.userId)
      const army = world.armies.find((a) => a.id === o.armyId)
      if (!army || !realm || army.realmId !== realm.id) return 'not one of your armies'
      return badScript(host, sender, o.scriptId)
    },
    apply(world, sender, order) {
      const { armyId, scriptId } = order as ArmyRunScriptRequest
      const army = world.armies.find((a) => a.id === armyId)
      if (!army) return
      orderKinds.armyStop!.apply(world, sender, { kind: 'armyStop', armyId })
      army.script = { scriptId, memory: {} }
    },
  }
}

/** A resident or an army running a script. */
interface Runner {
  /** Where the running script is kept: the resident or the army. */
  holder: { script?: RunningScript }
  id: string
  name: string
  /** How script events name it. */
  by: ScriptRunBy
  /** How the game API is bound for it. */
  bind: { residentId: string } | { armyId: string }
}

/** Runs every resident's and army's script once a tick. Keeps parsed scripts between ticks. */
export class ScriptRunner {
  private programs = new Map<number, { source: string; program: Program }>()

  constructor(
    private terrain: TerrainMap,
    private host: ScriptHost,
    private kinds: Record<string, OrderKind> = orderKinds,
  ) {}

  /**
   * Runs the scripts and applies what they requested. Realm by realm, each resident's or army's
   * script gets `SCRIPT_STEP_BUDGET` steps, or what is left of the realm's
   * `SCRIPT_REALM_STEP_BUDGET`; once that is used up the rest skip the tick. Who goes first
   * rotates with the tick. With `check`, returns the invariant violations found (ADR 0004).
   */
  runAll(world: WorldState, check = false): InvariantViolation[] {
    const out: InvariantViolation[] = []
    const byRealm = new Map<string, Runner[]>()
    const add = (realmId: string, runner: Runner) =>
      byRealm.set(realmId, [...(byRealm.get(realmId) ?? []), runner])
    for (const r of world.residents) {
      if (!r.script) continue
      // A script runs for the realm the resident takes orders from (`CONTEXT.md`: Alliance army);
      // a resident of no realm has no Player to run a script for.
      const realmId = commanderOf(world, r)
      // An NPC city runs its residents' game defaults itself (`runNpcScripts`).
      if (realmId === null) {
        if (!(r.script.task && r.script.scriptId === 0 && r.owner === null)) delete r.script
      } else {
        const by = { residentId: r.id }
        add(realmId, { holder: r, id: r.id, name: r.name, by, bind: by })
      }
    }
    for (const a of world.armies) {
      if (!a.script) continue
      const by = { armyId: a.id }
      add(a.realmId, { holder: a, id: a.id, name: a.name, by, bind: by })
    }
    const used = new Map<number, { source: string; program: Program }>()
    for (const realm of world.realms) {
      const running = byRealm.get(realm.id)
      const sender = this.host.sender(realm.userId)
      if (!running || !sender) continue
      let seen: SeenEntity[] | undefined
      const seenOnce = () => (seen ??= entitiesInSight(world, this.terrain, realm.id))
      const sees = seesOnce(world, this.terrain, realm.id)
      let left = SCRIPT_REALM_STEP_BUDGET
      const first = world.tick % running.length
      for (let i = 0; i < running.length; i++) {
        const r = running[(first + i) % running.length]!
        // Its script may have ended this tick.
        if (!r.holder.script) continue
        if (left <= 0) {
          logLimited(world, realm.id, r, 'budgetLoggedAt', outOfSteps(r, true))
          continue
        }
        const steps = Math.min(SCRIPT_STEP_BUDGET, left)
        left -= this.runOne(
          world,
          realm,
          sender,
          r,
          steps,
          { seen: seenOnce, sees },
          used,
          check ? out : undefined,
        )
      }
    }
    this.programs = used
    if (check) {
      out.push(...runningScriptsSound(world), ...scriptParamsSound(world))
      const unedited = (r: Resident) =>
        r.script!.scriptId !== 0 && this.host.script(r.script!.scriptId)?.followsDefault === true
      out.push(...oneCarrierAtATime(world, unedited), ...oneFetcherAtATime(world, unedited))
    }
    return out
  }

  /** Runs one resident's or army's script with `steps`; returns the steps it used. */
  private runOne(
    world: WorldState,
    realm: Realm,
    sender: OrderSender,
    r: Runner,
    steps: number,
    { seen, sees }: Pick<ScriptContext, 'seen' | 'sees'>,
    used: Map<number, { source: string; program: Program }>,
    violations: InvariantViolation[] | undefined,
  ): number {
    const running = r.holder.script!
    // Started on a task without a script of the Player's, a resident of theirs runs their version
    // of its default; one the realm commands but doesn't own (hired, lent) stops.
    if (running.scriptId === 0) {
      const owned = world.residents.some((x) => x.id === r.id && x.owner === realm.id)
      const id = running.task && owned ? this.host.defaultScript?.(realm.userId, running.task) : 0
      if (!id) {
        delete r.holder.script
        return 0
      }
      running.scriptId = id
    }
    const script = this.host.script(running.scriptId)
    if (!script || script.userId !== realm.userId) {
      // Deleted, or the resident now belongs to another Player, whose script it isn't.
      delete r.holder.script
      if (!script) {
        const { scriptId } = running
        recordEvent(world, realm.id, { kind: 'scriptEnded', ...r.by, name: r.name, scriptId })
      }
      return 0
    }
    // A saved change is picked up here: the active version's source is read every tick.
    let parsed = used.get(running.scriptId) ?? this.programs.get(running.scriptId)
    if (parsed?.source !== script.source) {
      // Active versions have no syntax errors (`checkScriptLibrary`), so this parses.
      parsed = { source: script.source, program: parse(script.source) }
    }
    used.set(running.scriptId, parsed)

    const memory = structuredClone(running.memory) as ScriptObject
    // A resident's picked param values; an army's params are never picked.
    const resident = 'residentId' in r.bind ? world.residents.find((x) => x.id === r.id) : undefined
    const declared = parsed.program.params
    const params = resident ? paramValues(world, resident, running.scriptId, declared) : declared
    const bound = bindScript({
      world,
      terrain: this.terrain,
      sender,
      ...r.bind,
      memory,
      params,
      seen,
      sees,
      explored: (x, y) => this.host.explored(realm.userId, x, y),
      kinds: this.kinds,
    })
    const { globals, requests } = bound
    const result = run(parsed.program, { globals, steps, maxCallDepth: SCRIPT_MAX_CALL_DEPTH })
    if (violations) {
      const sound = 'armyId' in r.bind ? armyScriptRequestsSound : scriptRequestsSound
      violations.push(...sound(world, this.terrain, sender, r.id, requests, this.kinds))
      // Invariant (ADR 0009): the game's defaults stay well within a resident's budget, so one
      // running out of it unedited is the game's bug, not the Player's.
      if (
        result.status === 'out-of-steps' &&
        script.followsDefault &&
        steps >= SCRIPT_STEP_BUDGET
      ) {
        violations.push({
          invariant: 'default-scripts-in-budget',
          message: `${r.id} ran out of steps running unedited default script ${running.scriptId}`,
          entityIds: [r.id],
        })
      }
    }
    // What it requested counts, even when it stopped with an error or out of steps.
    for (const order of requests) this.kinds[order.kind]!.apply(world, sender, order, this.terrain)
    if (bound.ended()) {
      endScript(world, r.id)
      return result.steps
    }

    const kept = keepMemory(memory)
    if (typeof kept === 'string') {
      logLimited(world, realm.id, r, 'errorLoggedAt', scriptError(r, running, kept))
    } else {
      running.memory = kept
    }
    if (result.status === 'error') {
      const { message, line, column } = result
      logLimited(
        world,
        realm.id,
        r,
        'errorLoggedAt',
        scriptError(r, running, message, line, column),
      )
    } else if (result.status === 'out-of-steps') {
      logLimited(world, realm.id, r, 'budgetLoggedAt', outOfSteps(r, steps < SCRIPT_STEP_BUDGET))
    }
    return result.steps
  }
}

/**
 * A resident's script called `end()` (`CONTEXT.md`: Running a script): it ends and they stand
 * idle; in a queue, its next step starts.
 */
function endScript(world: WorldState, residentId: string): void {
  const r = world.residents.find((x) => x.id === residentId)
  if (!r) return
  delete r.script
  r.order = null
}

const scriptError = (
  r: Runner,
  running: RunningScript,
  message: string,
  line?: number,
  column?: number,
): RealmEventWhat => ({
  kind: 'scriptError',
  ...r.by,
  name: r.name,
  scriptId: running.scriptId,
  message,
  ...(line === undefined ? {} : { line, column }),
})

const outOfSteps = (r: Runner, realm: boolean): RealmEventWhat => ({
  kind: 'scriptOutOfSteps',
  ...r.by,
  name: r.name,
  scriptId: r.holder.script!.scriptId,
  realm,
})

/**
 * Writes a script's trouble into the realm log, at most once every `SCRIPT_LOG_INTERVAL` ticks
 * for each resident or army and kind of trouble, so a script failing every tick doesn't flood it.
 */
function logLimited(
  world: WorldState,
  realmId: string,
  r: Runner,
  at: 'errorLoggedAt' | 'budgetLoggedAt',
  what: RealmEventWhat,
): void {
  // The script may have ended this tick, such as an army disbanded by its own script's request.
  const running = r.holder.script
  if (!running) return
  const last = running[at]
  if (last !== undefined && world.tick - last < SCRIPT_LOG_INTERVAL) return
  running[at] = world.tick
  recordEvent(world, realmId, what)
}

/**
 * A script's memory after a run as plain data to keep, or why it can't be kept; then the
 * memory from before the run stays.
 */
export function keepMemory(memory: ScriptObject): ScriptMemory | string {
  const hasFunction = (v: unknown): boolean =>
    v instanceof NativeFunction ||
    v instanceof ScriptFunction ||
    (typeof v === 'object' && v !== null && Object.values(v).some(hasFunction))
  let json: string
  try {
    if (hasFunction(memory)) return 'Memory can’t keep functions; this tick’s changes were dropped'
    json = JSON.stringify(memory)
  } catch {
    // Something that holds itself, which can't be kept as plain data.
    return 'Memory can’t keep something that holds itself; this tick’s changes were dropped'
  }
  if (json.length > SCRIPT_MEMORY_MAX) {
    return `Memory can keep at most ${SCRIPT_MEMORY_MAX} characters; this tick’s changes were dropped`
  }
  return JSON.parse(json) as ScriptMemory
}

/**
 * Invariant (ADR 0004): every running script, a resident's or an army's, names a script (or a
 * task, for its default), keeps
 * plain memory within `SCRIPT_MEMORY_MAX` and has logged no trouble in the future.
 */
export function runningScriptsSound(world: WorldState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  const holders = [
    ...world.residents.map((r) => ({ what: 'resident', id: r.id, s: r.script })),
    ...world.armies.map((a) => ({ what: 'army', id: a.id, s: a.script })),
  ]
  for (const { what, id, s } of holders) {
    if (!s) continue
    const fail = (message: string) =>
      out.push({
        invariant: 'running-scripts-sound',
        message: `${what} ${id} ${message}`,
        entityIds: [id],
      })
    // 0 only while it runs a task's default without a script of the Player's.
    const none = s.scriptId === 0 && s.task !== undefined && isTask(s.task)
    if (!Number.isInteger(s.scriptId) || (s.scriptId <= 0 && !none))
      fail(`runs script ${s.scriptId}`)
    const kept = keepMemory(s.memory as ScriptObject)
    if (typeof kept === 'string') fail(`keeps memory it can't: ${kept}`)
    else if (JSON.stringify(kept) !== JSON.stringify(s.memory))
      fail('keeps memory that is not plain data')
    for (const at of [s.errorLoggedAt, s.budgetLoggedAt]) {
      if (at !== undefined && at > world.tick)
        fail(`logged script trouble at tick ${at}, after ${world.tick}`)
    }
  }
  return out
}

/** The game's default scripts as parsed, by source, for NPC cities. */
const gamePrograms = new Map<string, Program>()

/**
 * An NPC city's residents run the game's default of their task (`CONTEXT.md`: NPC city, Default
 * script; ADR 0009), through the same interpreter and game API as a Player's scripts, with the
 * city as the sender: it sees what its residents see, explored or not, and has no realm budget.
 * What they request is applied at once, as a Player's scripts' requests are. Run after
 * `stepNpcCities` has put them to work.
 */
export function runNpcScripts(
  world: WorldState,
  terrain: TerrainMap,
  kinds: Record<string, OrderKind> = orderKinds,
): void {
  const npc = new Map(world.cities.filter((c) => c.realmId === null).map((c) => [c.id, c]))
  const byCity = new Map<City, Resident[]>()
  for (const r of world.residents) {
    const city = r.cityId === null ? undefined : npc.get(r.cityId)
    if (!city || r.owner !== null || r.script?.scriptId !== 0 || !r.script.task) continue
    const list = byCity.get(city) ?? []
    list.push(r)
    byCity.set(city, list)
  }
  for (const [city, people] of byCity) runCityScripts(world, terrain, city, people, kinds)
}

function runCityScripts(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  people: readonly Resident[],
  kinds: Record<string, OrderKind>,
): void {
  const sender = npcSender(city)
  let seen: SeenEntity[] | undefined
  const seenOnce = () => (seen ??= entitiesInSight(world, terrain, city.id))
  const sees = seesOnce(world, terrain, city.id)
  for (const r of people) {
    const running = r.script
    // Its script may have ended this tick; a resident lent out is run by the hirer.
    if (!running?.task || !orderedResident(world, sender, r.id)) continue
    const { source } = DEFAULT_SCRIPTS[running.task]
    let program = gamePrograms.get(source)
    if (!program) gamePrograms.set(source, (program = parse(source)))
    const memory = structuredClone(running.memory) as ScriptObject
    const bound = bindScript({
      world,
      terrain,
      sender,
      residentId: r.id,
      memory,
      seen: seenOnce,
      sees,
      explored: () => true,
      kinds,
      // Nobody picks values for an NPC city: its defaults fall back on their own.
      params: program.params,
    })
    const { globals, requests } = bound
    run(program, { globals, steps: SCRIPT_STEP_BUDGET, maxCallDepth: SCRIPT_MAX_CALL_DEPTH })
    for (const order of requests) kinds[order.kind]!.apply(world, sender, order, terrain)
    if (bound.ended()) {
      endScript(world, r.id)
      continue
    }
    const kept = keepMemory(memory)
    if (typeof kept !== 'string' && r.script === running) running.memory = kept
  }
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Carrying the output): at most one resident of a workplace is
 * away carrying its output at once, among those running the Work default as the game ships it
 * (`counts`): an NPC city's, or a Player's who hasn't edited it.
 */
export function oneCarrierAtATime(
  world: WorldState,
  counts: (r: Resident) => boolean,
): InvariantViolation[] {
  return oneAwayAtATime(world, counts, 'workplaceId', 'carry').map(([place, ids]) => ({
    invariant: 'one-carrier-at-a-time',
    message: `${ids.length} residents carry ${place}'s output at once: ${ids.join(', ')}`,
    entityIds: [place, ...ids],
  }))
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Fetching materials): at most one resident building a site
 * is away fetching its materials at once, among those running the Build default as the game
 * ships it (`counts`).
 */
export function oneFetcherAtATime(
  world: WorldState,
  counts: (r: Resident) => boolean,
): InvariantViolation[] {
  return oneAwayAtATime(world, counts, 'siteId', 'fetch').map(([site, ids]) => ({
    invariant: 'one-fetcher-at-a-time',
    message: `${ids.length} residents fetch materials for ${site} at once: ${ids.join(', ')}`,
    entityIds: [site, ...ids],
  }))
}

/**
 * The residents counted (`counts`) whose script memory has `away` set, by the `key` in their
 * memory they share, where more than one share it.
 */
function oneAwayAtATime(
  world: WorldState,
  counts: (r: Resident) => boolean,
  key: string,
  away: string,
): [string, string[]][] {
  const byKey = new Map<string, string[]>()
  for (const r of world.residents) {
    const s = r.script
    const at = s?.memory[key]
    if (!s || typeof at !== 'string' || s.memory[away] == null || !counts(r)) continue
    const ids = byKey.get(at) ?? []
    ids.push(r.id)
    byKey.set(at, ids)
  }
  return [...byKey].filter(([, ids]) => ids.length > 1)
}

/** What a realm or an NPC city sees (`sightOf`), worked out once when first asked. */
function seesOnce(world: WorldState, terrain: TerrainMap, side: string) {
  let sight: ((at: { x: number; y: number }) => boolean) | undefined
  return (at: { x: number; y: number }) => (sight ??= sightOf(world, terrain.size, side))(at)
}
