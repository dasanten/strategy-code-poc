import {
  NativeFunction,
  ScriptFunction,
  parse,
  run,
  type Program,
  type ScriptObject,
} from '@csp/lang'
import {
  commanderOf,
  commands,
  SCRIPT_LOG_INTERVAL,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MEMORY_MAX,
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  type OrderRequest,
  type Realm,
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
import { orderKinds, type OrderKind, type OrderSender } from './orders.js'
import { armyScriptRequestsSound, bindScript, scriptRequestsSound } from './script-bindings.js'
import type { RunnableScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
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
      if (realmId === null) delete r.script
      else {
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
        left -= this.runOne(world, realm, sender, r, steps, seenOnce, used, check ? out : undefined)
      }
    }
    this.programs = used
    if (check) out.push(...runningScriptsSound(world))
    return out
  }

  /** Runs one resident's or army's script with `steps`; returns the steps it used. */
  private runOne(
    world: WorldState,
    realm: Realm,
    sender: OrderSender,
    r: Runner,
    steps: number,
    seen: () => SeenEntity[],
    used: Map<number, { source: string; program: Program }>,
    violations: InvariantViolation[] | undefined,
  ): number {
    const running = r.holder.script!
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
    const { globals, requests } = bindScript({
      world,
      terrain: this.terrain,
      sender,
      ...r.bind,
      memory,
      seen,
      explored: (x, y) => this.host.explored(realm.userId, x, y),
      kinds: this.kinds,
    })
    const result = run(parsed.program, { globals, steps, maxCallDepth: SCRIPT_MAX_CALL_DEPTH })
    if (violations) {
      const sound = 'armyId' in r.bind ? armyScriptRequestsSound : scriptRequestsSound
      violations.push(...sound(world, this.terrain, sender, r.id, requests, this.kinds))
    }
    // What it requested counts, even when it stopped with an error or out of steps.
    for (const order of requests) this.kinds[order.kind]!.apply(world, sender, order, this.terrain)

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
 * Invariant (ADR 0004): every running script, a resident's or an army's, names a script, keeps
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
    if (!Number.isInteger(s.scriptId) || s.scriptId <= 0) fail(`runs script ${s.scriptId}`)
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
