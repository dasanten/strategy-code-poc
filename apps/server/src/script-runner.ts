import { parse, run, scriptParams, type Program, type ScriptObject } from '@csp/lang'
import {
  buildAtProblem,
  buildingAt,
  constructionAt,
  canWork,
  DEFAULT_SCRIPTS,
  MAP_SIZE,
  stableAt,
  commands,
  isTask,
  isTrainingSubject,
  keptPair,
  type Good,
  type Task,
  type TaskMemory,
  SCRIPT_LOG_INTERVAL,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MEMORY_MAX,
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  SCRIPT_VALUE_LIMITS,
  type BuildingKind,
  type City,
  type OrderRequest,
  type Realm,
  type Resident,
  type ResidentOrder,
  type RealmEventWhat,
  type RunningScript,
  type ScriptMemory,
  type ScriptRunBy,
  type StartParamValues,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { resumeInterrupted } from './defence.js'
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
import { plainValue } from './plain-value.js'
import { addToScriptLog } from './script-log.js'
import type { RunnableScript } from './scripts.js'
import {
  paramTarget,
  paramValues,
  scriptParamsSound,
  setStartParams,
  startParamsProblem,
  withTargetParam,
} from './script-params.js'
import { entitiesInSight, withSight } from './sight.js'
import { realmOf } from './starting-city.js'
import { worldIndex } from './world-index.js'

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
  /**
   * Where an error of the game's own while running scripts is reported (ADR 0004). One in a
   * script's run ends that script and is reported with its `scriptId` and resident or army; one
   * in a realm's set-up skips the realm's scripts for the tick and is reported without. Either
   * way the tick goes on.
   */
  scriptError?(world: WorldState, error: unknown, where: ScriptErrorWhere): void
}

/** Where an error of the game's own hit while running scripts (`ScriptHost.scriptError`). */
export interface ScriptErrorWhere {
  realmId: string
  /** The resident or army whose script ended; none when the whole realm's set-up failed. */
  entityIds: string[]
  scriptId?: number
}

interface RunScriptRequest extends OrderRequest {
  kind: 'runScript'
  residentId: string
  scriptId: number
  /** Values for the script's params, set before its first tick (`CONTEXT.md`: Before it starts). */
  params?: StartParamValues
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
 * Why the param values an order starting script `scriptId` gives don't fit its `param` lines
 * (`startParamsProblem`), if they don't; none given always fit.
 */
function paramsProblem(
  host: { script(scriptId: number): Pick<RunnableScript, 'source'> | undefined },
  world: WorldState,
  realmId: string,
  scriptId: number,
  params: unknown,
): string | undefined {
  if (params === undefined) return undefined
  const source = host.script(scriptId)?.source
  if (source === undefined) return 'not one of your scripts with a version that can run'
  return startParamsProblem(world, realmId, scriptParams(source), params)
}

/**
 * The run-script order: one of the Player's residents runs one of the Player's scripts, from a
 * fresh memory, with the param values it gives set first (`CONTEXT.md`: Before it starts); a
 * default script's target param is cleared unless it gives one (`withTargetParam`). It ends
 * whatever the resident was doing.
 */
export function runScriptOrder(host: Pick<ScriptHost, 'script'>): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<RunScriptRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      return (
        badScript(host, sender, o.scriptId) ??
        paramsProblem(host, world, realm.id, o.scriptId!, o.params)
      )
    },
    apply(world, _sender, order) {
      const { residentId, scriptId, params } = order as RunScriptRequest
      const r = world.residents.find((x) => x.id === residentId)
      if (!r) return
      r.order = null
      r.script = { scriptId, memory: {} }
      setStartParams(r, scriptId, withTargetParam(host.script(scriptId), params))
    },
  }
}

interface SetDefenceScriptRequest extends OrderRequest {
  kind: 'setDefenceScript'
  residentId: string
  /** The Player's script to run when struck, or null for the Defend default. */
  scriptId: number | null
  /** Values for the script's params, kept for the resident (`CONTEXT.md`: Before it starts). */
  params?: StartParamValues
}

/**
 * The set-defence-script order (`CONTEXT.md`: Defence script): the Player picks one of their
 * scripts as the defence script of a resident of their own, or with null clears it, back to the
 * Defend default; picking their Defend itself clears it too. Free and instant; it leaves what
 * the resident does as it is. Any of their scripts may be picked, a default other than Defend
 * too. The param values it gives are kept for the resident and the script, as a start's are.
 */
export function setDefenceScriptOrder(host: Pick<ScriptHost, 'script'>): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<SetDefenceScriptRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !r || r.owner !== realm.id) return 'not one of your residents'
      if (o.scriptId === null) return o.params === undefined ? undefined : 'Defend takes no params'
      return (
        badScript(host, sender, o.scriptId) ??
        paramsProblem(host, world, realm.id, o.scriptId!, o.params)
      )
    },
    apply(world, _sender, order) {
      const { residentId, scriptId, params } = order as SetDefenceScriptRequest
      const r = world.residents.find((x) => x.id === residentId)
      if (!r) return
      if (scriptId === null || host.script(scriptId)?.task === 'defend') {
        delete r.defenceScriptId
        return
      }
      r.defenceScriptId = scriptId
      setStartParams(r, scriptId, params)
    },
  }
}

/** Where a task order finds the Player's version of a task's default script. */
export interface DefaultScriptHost {
  /** The id of the Player's version of the task's default script, made if they have none. */
  defaultScript(userId: number, task: Task): number
  /** The script's active version, to check the param values a task gives against. */
  script?(scriptId: number): Pick<RunnableScript, 'source'> | undefined
}

/** What every task order may carry besides its target. */
interface TaskParams {
  /** Values for the default script's params, set before its first tick (`CONTEXT.md`: Before it starts). */
  params?: StartParamValues
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

/**
 * Train: the training ground the resident stands on (`CONTEXT.md`: Trainee), and the subject
 * they mean to learn there, if any.
 */
interface TrainTaskRequest extends OrderRequest {
  kind: 'task'
  task: 'train'
  residentId: string
  groundId: string
  subject?: string
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

type TaskRequest = (
  | WorkTaskRequest
  | BuildTaskRequest
  | HaulTaskRequest
  | TearDownTaskRequest
  | BreedTaskRequest
  | FeedStableTaskRequest
  | TrainTaskRequest
) &
  TaskParams

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
  if (o.task === 'train') return { kind: 'train', residentId, buildingId: o.groundId }
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
    case 'train': {
      const memory: TaskMemory['train'] = { groundId: order.groundId }
      if (order.subject !== undefined) memory.subject = order.subject
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
 * Build as the build order on the resident's tile or the one it names, Haul as the haul order to
 * a tile, Tear down as the tear-down order, Breed horses as the breed order, Train as the train
 * order. Feed the stable starts no order of its own: the resident stands in the stable and is
 * grown up. The param values it gives are checked
 * against the default script's and set first (`CONTEXT.md`: Before it starts), the task's target
 * in the script's target param (`withTargetParam`, `taskTarget`).
 */
export function taskOrder(host: DefaultScriptHost): OrderKind {
  return {
    validate(world, sender, order, terrain) {
      const o = order as Partial<TaskRequest>
      const problem = taskProblem(world, sender, o, terrain)
      if (problem !== undefined || o.params === undefined) return problem
      if (!host.script) return 'the task takes no params'
      const realm = realmOf(world, sender.userId)!
      const scriptId = host.defaultScript(sender.userId, o.task!)
      return paramsProblem({ script: host.script }, world, realm.id, scriptId, o.params)
    },
    apply(world, sender, order) {
      const realmId = realmOf(world, sender.userId)?.id
      const o = withKeptPair(world, order as TaskRequest, realmId) as TaskRequest
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!r) return
      r.order = null
      const scriptId = host.defaultScript(sender.userId, o.task)
      r.script = { scriptId, memory: taskMemory(o, r) }
      const source = host.script?.(scriptId)?.source
      const script = source === undefined ? undefined : { source, task: o.task }
      const target = taskTarget(world, realmId, o, r)
      setStartParams(r, scriptId, withTargetParam(script, o.params, target))
    },
  }
}

/**
 * The task's target as its default's target param holds it (`TARGET_PARAMS`): Work's workplace,
 * Tear down's building, the stable of Breed horses and Feed the stable, Haul's carriage, and for
 * Build the unfinished site of its kind it joins at `at` (or the resident's tile); none while
 * Build lays out a new one, which isn't there yet. Only one of the realm's own, which a param can
 * name; another's stays in the memory alone (`TaskMemory`).
 */
function taskTarget(
  world: WorldState,
  realmId: string | undefined,
  o: TaskRequest,
  r: { x: number; y: number },
): string | undefined {
  const [id, type] =
    o.task === 'work'
      ? [o.workplaceId, 'building' as const]
      : o.task === 'tearDown'
        ? [o.buildingId, 'building' as const]
        : o.task === 'train'
          ? [o.groundId, 'building' as const]
          : o.task === 'breed' || o.task === 'feedStable'
            ? [o.stableId, 'storage' as const]
            : o.task === 'haul'
              ? [o.carriageId, 'storage' as const]
              : [buildSite(world, o, r), 'building' as const]
  if (id === undefined) return undefined
  return paramTarget(world, realmId, type, id) ? id : undefined
}

/** The unfinished site a Build task joins at `at` (or the resident's tile), if one stands there. */
function buildSite(
  world: WorldState,
  o: Extract<TaskRequest, { task: 'build' }>,
  r: { x: number; y: number },
): string | undefined {
  const at = o.at ?? r
  const site = constructionAt(world, at.x, at.y, o.building)
  return site?.site && site.kind === o.building ? site.id : undefined
}

/** Why the resident can't be given the task on its target, if they can't (`taskOrder`). */
function taskProblem(
  world: WorldState,
  sender: OrderSender,
  o: Partial<TaskRequest>,
  terrain: TerrainMap | undefined,
): string | undefined {
  // Being struck starts Defend (`CONTEXT.md`: Defence script); it is no task to give.
  if ((o.task as unknown) === 'defend') return 'Defend runs when they are struck'
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
  if (o.task === 'train' && o.subject !== undefined && !isTrainingSubject(o.subject))
    return 'train a stat or a skill'
  const built = asOrder(withKeptPair(world, o, realm.id))
  const problem = orderKinds[built.kind]!.validate(world, sender, built, terrain)
  // Working there by a bare work-at order, as the starting residents do, they can still be
  // given the task; already running it there, they can't.
  if ((problem === 'already working here' || problem === 'already training here') && !r.script)
    return undefined
  return problem
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

/**
 * The order each waiting script waits on (`RunningScript.waitingSince`), by identity: a replaced
 * order is another object. Scratch memory, never saved: after a restart a waiting script runs
 * once more and waits again.
 */
const waitingOn = new WeakMap<RunningScript, ResidentOrder>()

/**
 * Whether resident `r`'s script waits this tick (`CONTEXT.md`: Running a script, Waiting): it
 * called `wait()` and the order it waits on still runs, unreplaced, and no blow struck them since.
 * Otherwise its wait is over and it runs every tick again.
 */
function waits(r: Resident): boolean {
  const running = r.script
  if (running?.waitingSince === undefined) return false
  const struck = r.struck !== undefined && r.struck.tick >= running.waitingSince
  if (r.order !== null && waitingOn.get(running) === r.order && !struck) return true
  delete running.waitingSince
  return false
}

/**
 * After a run that called `wait()`, resident `r`'s script waits on the order they have now that
 * its requests are applied; with none, or with its script ended or replaced, it does nothing.
 */
function startWaiting(world: WorldState, r: Resident | undefined, running: RunningScript): void {
  if (!r || r.script !== running || r.order === null) return
  running.waitingSince = world.tick
  waitingOn.set(running, r.order)
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Running a script, Waiting): once scripts have run, every
 * waiting script of `residents` has an order to wait on, the one it called `wait()` with, and
 * began waiting no later than now: no script waits past its order's end.
 */
export function waitingSound(
  world: WorldState,
  residents: readonly Resident[],
): InvariantViolation[] {
  const out: InvariantViolation[] = []
  for (const r of residents) {
    const since = r.script?.waitingSince
    if (since === undefined) continue
    const fail = (message: string) =>
      out.push({
        invariant: 'waiting-has-an-order',
        message: `${r.id} ${message}`,
        entityIds: [r.id],
      })
    if (r.order === null) fail('waits with no order')
    else if (waitingOn.has(r.script!) && waitingOn.get(r.script!) !== r.order)
      fail('waits past the end of the order it waited on')
    if (since > world.tick) fail(`began waiting at tick ${since}, after ${world.tick}`)
  }
  return out
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
  /**
   * The scripts that ran the last `runAll`, waiting ones and those the realm's budget skipped
   * left out: for tick health (ADR 0004).
   */
  runs = 0

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
    const index = worldIndex(world)
    // The residents whose scripts the realms run, waiting or not.
    const commanded: Resident[] = []
    for (const r of world.residents) {
      if (!r.script) continue
      // A script runs for the realm the resident takes orders from (`CONTEXT.md`: Alliance army);
      // a resident of no realm has no Player to run a script for.
      const realmId = index.commanderOf(r)
      // An NPC city runs its residents' game defaults itself (`runNpcScripts`).
      if (realmId === null) {
        // Nobody runs their defence script any more: what it interrupted goes on, if anything.
        resumeInterrupted(r)
        if (r.script && !(r.script.task && r.script.scriptId === 0 && r.owner === null))
          delete r.script
      } else {
        commanded.push(r)
        if (waits(r)) continue
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
    // Those whose script ran this tick, not skipped for the realm's budget.
    const ran = new Set<string>()
    withSight(world, this.terrain.size, () => {
      for (const realm of world.realms) {
        // A bug of the game's in one realm's scripts never stops the other realms' or the tick.
        try {
          this.runRealm(world, realm, byRealm.get(realm.id), used, ran, check ? out : undefined)
        } catch (error) {
          this.host.scriptError?.(world, error, { realmId: realm.id, entityIds: [] })
        }
      }
    })
    this.programs = used
    this.runs = ran.size
    if (check) {
      out.push(...runningScriptsSound(world), ...scriptParamsSound(world))
      out.push(...waitingSound(world, commanded))
      const unedited = (r: Resident) =>
        r.script!.scriptId !== 0 && this.host.script(r.script!.scriptId)?.followsDefault === true
      out.push(...oneCarrierAtATime(world, unedited), ...oneFetcherAtATime(world, unedited))
      const taskOf = (r: Resident) =>
        ran.has(r.id) && unedited(r) ? this.host.script(r.script!.scriptId)?.task : undefined
      out.push(...defaultsHaveATarget(world, taskOf))
    }
    return out
  }

  /** Runs one realm's scripts in turn, within the realm's step budget. */
  private runRealm(
    world: WorldState,
    realm: Realm,
    running: Runner[] | undefined,
    used: Map<number, { source: string; program: Program }>,
    ran: Set<string>,
    violations: InvariantViolation[] | undefined,
  ): void {
    const sender = this.host.sender(realm.userId)
    if (!running || !sender) return
    // Worked out once for the realm this phase and shared (`SightCache`, opened by `runAll`).
    const seen = () => entitiesInSight(world, this.terrain, realm.id)
    let left = SCRIPT_REALM_STEP_BUDGET
    const first = world.tick % running.length
    for (let i = 0; i < running.length; i++) {
      const r = running[(first + i) % running.length]!
      // Its script may have ended this tick.
      if (!r.holder.script) continue
      if (left <= 0) {
        r.holder.script.lastRun = { steps: 0, outOfSteps: 'realm' }
        logLimited(world, realm.id, r, 'budgetLoggedAt', outOfSteps(r, true))
        continue
      }
      ran.add(r.id)
      const steps = Math.min(SCRIPT_STEP_BUDGET, left)
      try {
        left -= this.runOne(world, realm, sender, r, steps, { seen }, used, violations)
      } catch (error) {
        // The game's own bug, not the script's: it ends this one script and the tick goes on.
        left -= steps
        this.failedInGame(world, realm, r, error)
      }
    }
  }

  /**
   * A script's run threw something the game didn't expect, from a native or from applying what
   * it requested: a bug in the game. The script ends as with `end()`, the realm log notes it
   * once (the script doesn't run again, so it isn't rate-limited) and monitoring gets the error.
   */
  private failedInGame(world: WorldState, realm: Realm, r: Runner, error: unknown): void {
    const running = r.holder.script
    const scriptId = running?.scriptId
    if (running) {
      const message = `the game hit an error running this script, so it ended: ${errorMessage(error)}`
      recordEvent(world, realm.id, scriptError(r, running, message))
      // A resident's ends as on `end()`: a defence script hands back to what it interrupted.
      if ('residentId' in r.bind) endScript(world, r.id)
      else delete r.holder.script
    }
    const where = scriptId === undefined ? {} : { scriptId }
    this.host.scriptError?.(world, error, { realmId: realm.id, entityIds: [r.id], ...where })
  }

  /** Runs one resident's or army's script with `steps`; returns the steps it used. */
  private runOne(
    world: WorldState,
    realm: Realm,
    sender: OrderSender,
    r: Runner,
    steps: number,
    { seen }: Pick<ScriptContext, 'seen'>,
    used: Map<number, { source: string; program: Program }>,
    violations: InvariantViolation[] | undefined,
  ): number {
    const running = r.holder.script!
    // Started on a task without a script of the Player's, a resident of theirs runs their version
    // of its default; one the realm commands but doesn't own (hired, lent) stops, but for
    // Defend: struck, they defend themselves as the realm commanding them has it.
    if (running.scriptId === 0) {
      const owned = world.residents.some((x) => x.id === r.id && x.owner === realm.id)
      const runs = owned || running.task === 'defend'
      const id = running.task && runs ? this.host.defaultScript?.(realm.userId, running.task) : 0
      if (!id) {
        stopScript(world, r)
        return 0
      }
      running.scriptId = id
    }
    const script = this.host.script(running.scriptId)
    const resident = 'residentId' in r.bind ? world.residents.find((x) => x.id === r.id) : undefined
    if (
      (!script || script.userId !== realm.userId) &&
      running.task === 'defend' &&
      resident?.defenceScriptId === running.scriptId
    ) {
      // The defence script picked is deleted or no longer theirs: they defend by the Defend
      // default, from now on (`CONTEXT.md`: Defence script).
      const { scriptId } = running
      delete resident.defenceScriptId
      recordEvent(world, realm.id, {
        kind: 'defenceScriptGone',
        residentId: r.id,
        name: r.name,
        scriptId,
      })
      running.scriptId = 0
      return this.runOne(world, realm, sender, r, steps, { seen }, used, violations)
    }
    if (!script || script.userId !== realm.userId) {
      // Deleted, or the resident now belongs to another Player, whose script it isn't.
      stopScript(world, r)
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
    // An error belongs to the version that ran into it; another one running clears it.
    if (running.lastError && running.lastError.version !== script.version) delete running.lastError

    const memory = structuredClone(running.memory) as ScriptObject
    // A resident's picked param values; an army's params are never picked.
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
      explored: (x, y) => this.host.explored(realm.userId, x, y),
      kinds: this.kinds,
    })
    const { globals, requests } = bound
    const result = run(parsed.program, {
      globals,
      steps,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
      limits: SCRIPT_VALUE_LIMITS,
    })
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
    // So are its log lines, and the reason it ended with goes in the log after them. Only the
    // owning Player reads the log, so a hirer's script, run by a resident they don't own, logs none.
    const reason = bound.ended() ? bound.endReason() : null
    if (resident?.owner === realm.id) {
      addToScriptLog(
        resident,
        world.tick,
        reason === null ? bound.logged : [...bound.logged, reason],
      )
    }
    if (bound.ended()) {
      endScript(world, r.id)
      // A reason is noted each time, not rate-limited: an end is no error.
      if (reason !== null) {
        recordEvent(world, realm.id, {
          kind: 'scriptStopped',
          ...r.by,
          name: r.name,
          scriptId: running.scriptId,
          script: script.name,
          reason,
        })
      }
      return result.steps
    }
    if (bound.waited()) startWaiting(world, resident, running)

    const failed = (message: string, line?: number, column?: number) => {
      const where = line === undefined ? {} : { line, column }
      running.lastError = { message, ...where, tick: world.tick, version: script.version }
      logLimited(
        world,
        realm.id,
        r,
        'errorLoggedAt',
        scriptError(r, running, message, line, column),
      )
    }
    const kept = keepMemory(memory)
    if (typeof kept === 'string') failed(kept)
    else running.memory = kept
    const realmCut = steps < SCRIPT_STEP_BUDGET
    running.lastRun = { steps: result.steps }
    if (result.status === 'error') {
      failed(result.message, result.line, result.column)
    } else if (result.status === 'out-of-steps') {
      running.lastRun.outOfSteps = realmCut ? 'realm' : 'own'
      logLimited(world, realm.id, r, 'budgetLoggedAt', outOfSteps(r, realmCut))
    }
    return result.steps
  }
}

/**
 * A resident's script called `end()` (`CONTEXT.md`: Running a script): it ends and they stand
 * idle; in a queue, its next step starts. A defence script hands back to what it interrupted
 * (`CONTEXT.md`: Defence script).
 */
function endScript(world: WorldState, residentId: string): void {
  const r = world.residents.find((x) => x.id === residentId)
  if (!r || resumeInterrupted(r)) return
  delete r.script
  r.order = null
}

/**
 * A script that can't run any more stops; a resident's defence script hands back to what it
 * interrupted, as on `end()`.
 */
function stopScript(world: WorldState, r: Runner): void {
  const resident = 'residentId' in r.bind ? world.residents.find((x) => x.id === r.id) : undefined
  if (resident && resumeInterrupted(resident)) return
  delete r.holder.script
}

/** What an error of the game's own says, short enough for the realm log. */
function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
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
  const plain = plainValue(memory, SCRIPT_MEMORY_MAX)
  if (plain.ok) return plain.value as ScriptMemory
  switch (plain.why) {
    case 'function':
      return 'Memory can’t keep functions; this tick’s changes were dropped'
    case 'cycle':
      return 'Memory can’t keep something that holds itself; this tick’s changes were dropped'
    case 'size':
      return `Memory can keep at most ${SCRIPT_MEMORY_MAX} characters; this tick’s changes were dropped`
  }
}

/**
 * Invariant (ADR 0004): every running script, a resident's or an army's, names a script (or a
 * task, for its default), keeps
 * plain memory within `SCRIPT_MEMORY_MAX`, has logged no trouble and kept no error from the
 * future, and used no more steps than its budget.
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
    if (s.lastError && s.lastError.tick > world.tick)
      fail(`kept an error from tick ${s.lastError.tick}, after ${world.tick}`)
    const used = s.lastRun?.steps
    if (used !== undefined && !(Number.isInteger(used) && used >= 0 && used <= SCRIPT_STEP_BUDGET))
      fail(`used ${used} steps, outside its budget of ${SCRIPT_STEP_BUDGET}`)
  }
  return out
}

/** The game's default scripts as parsed, by source, for NPC cities. */
const gamePrograms = new Map<string, Program>()

/**
 * An NPC city's residents run the game's default of their task (`CONTEXT.md`: NPC city, Default
 * script; ADR 0009), through the same interpreter and game API as a Player's scripts, with the
 * city as the sender: it sees what its residents see, explored or not, and has no realm budget.
 * What they request is applied at once, as a Player's scripts' requests are; one that waits
 * (`CONTEXT.md`: Running a script, Waiting) skips the tick. Run after `stepNpcCities` has put
 * them to work. Returns how many scripts ran, for tick health.
 */
export function runNpcScripts(
  world: WorldState,
  terrain: TerrainMap,
  kinds: Record<string, OrderKind> = orderKinds,
): number {
  const npc = new Map(world.cities.filter((c) => c.realmId === null).map((c) => [c.id, c]))
  const byCity = new Map<City, Resident[]>()
  for (const r of world.residents) {
    const city = r.cityId === null ? undefined : npc.get(r.cityId)
    if (!city || r.owner !== null || r.script?.scriptId !== 0 || !r.script.task) continue
    const list = byCity.get(city) ?? []
    list.push(r)
    byCity.set(city, list)
  }
  return withSight(world, terrain.size, () => {
    let runs = 0
    for (const [city, people] of byCity) runs += runCityScripts(world, terrain, city, people, kinds)
    return runs
  })
}

/** Runs one NPC city's residents' scripts; returns how many ran. */
function runCityScripts(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  people: readonly Resident[],
  kinds: Record<string, OrderKind>,
): number {
  const sender = npcSender(city)
  // Worked out once for the city this phase and shared (`SightCache`, opened by `runNpcScripts`).
  const seen = () => entitiesInSight(world, terrain, city.id)
  let runs = 0
  for (const r of people) {
    const running = r.script
    // Its script may have ended this tick; a resident lent out is run by the hirer.
    if (!running?.task || !orderedResident(world, sender, r.id) || waits(r)) continue
    runs++
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
      seen,
      explored: () => true,
      kinds,
      // Nobody picks values for an NPC city: its defaults fall back on their own.
      params: program.params,
    })
    const { globals, requests } = bound
    run(program, {
      globals,
      steps: SCRIPT_STEP_BUDGET,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
      limits: SCRIPT_VALUE_LIMITS,
    })
    // What it logs is dropped: no Player owns an NPC city's residents to read their script log.
    for (const order of requests) kinds[order.kind]!.apply(world, sender, order, terrain)
    if (bound.ended()) {
      endScript(world, r.id)
      continue
    }
    if (bound.waited()) startWaiting(world, r, running)
    const kept = keepMemory(memory)
    if (typeof kept !== 'string' && r.script === running) running.memory = kept
  }
  return runs
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

/** What a default script keeps in memory once it knows its target (`defaultsHaveATarget`). */
const TARGET_KNOWN: Partial<
  Record<Task, { invariant: string; memory: readonly string[]; without: string }>
> = {
  work: {
    invariant: 'workers-have-a-workplace',
    memory: ['workplaceId'],
    without: 'Work without a workplace',
  },
  build: {
    invariant: 'builders-have-a-site',
    memory: ['building', 'at'],
    without: 'Build without a site',
  },
  haul: {
    invariant: 'haulers-have-a-route',
    memory: ['to', 'carriageId'],
    without: 'Haul without a route or carriage',
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Default script, Started directly): a resident running the
 * Work, Build or Haul default as the game ships it (`taskOf` names the task, for those that
 * count) knows its target once it has run: Work its workplace (`memory.workplaceId`), Build the
 * site's kind and place (`memory.building`, `memory.at`), Haul its route and carriage
 * (`memory.to`, `memory.carriageId`). With none picked and none on their tile, or Haul with no
 * route, it ends, so nobody runs one for longer than a tick without its target.
 */
export function defaultsHaveATarget(
  world: WorldState,
  taskOf: (r: Resident) => Task | undefined,
): InvariantViolation[] {
  const out: InvariantViolation[] = []
  for (const r of world.residents) {
    if (!r.script) continue
    const memory = r.script.memory
    const task = taskOf(r)
    const known = task && TARGET_KNOWN[task]
    if (!known || known.memory.every((key) => memory[key] != null)) continue
    out.push({
      invariant: known.invariant,
      message: `${r.id} runs ${known.without}`,
      entityIds: [r.id],
    })
  }
  return out
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
