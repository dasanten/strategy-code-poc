import { scriptParams } from '@csp/lang'
import {
  WORKPLACE_PARAM,
  isParamNumber,
  isWorkScript,
  takesWorkSettings,
  type OrderRequest,
  type Resident,
  type RunningScript,
  type ScriptParam,
  type ScriptParamValue,
  type StartParamValues,
  type Task,
  type TaskMemory,
  type WorkplaceSettings,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { paramTarget, setStartParams, startParamsProblem } from './script-params.js'
import type { RunnableScript } from './scripts.js'
import { realmOf } from './starting-city.js'
import { worldIndex } from './world-index.js'

/**
 * Workplace settings (`CONTEXT.md`; ADR 0020): for each workplace, or construction site of a
 * workplace kind, it knows, a realm keeps a work script and values for its params, set on the
 * building's card (`WorldState.workplaceSettings`). Other realms never see them; NPC cities keep
 * none.
 */

/** Where the settings order finds the Player's scripts. */
export interface WorkSettingsHost {
  /** The script's Player and active version; undefined once it is deleted. */
  script(scriptId: number): Pick<RunnableScript, 'userId' | 'source' | 'task'> | undefined
  /** The id of the Player's version of a task's default script, made if they have none. */
  defaultScript(userId: number, task: Task): number
}

/** The realm's settings for a building, if it set any. */
export function workSettingsOf(
  world: WorldState,
  realmId: string,
  buildingId: string,
): WorkplaceSettings | undefined {
  return world.workplaceSettings[realmId]?.[buildingId]
}

/**
 * The work script giving Work at a workplace runs for the Player (`CONTEXT.md`: Workplace
 * settings): the one its settings name while it is still theirs and a work script, else their
 * Work default.
 */
export function workScriptId(
  host: WorkSettingsHost,
  userId: number,
  settings: WorkplaceSettings | undefined,
): number {
  const id = settings?.scriptId
  const picked = id === undefined ? undefined : host.script(id)
  return picked && picked.userId === userId && isWorkScript(scriptParams(picked.source))
    ? id!
    : host.defaultScript(userId, 'work')
}

/** The `param` lines of the work script the settings name (`workScriptId`). */
function workScriptParams(
  host: WorkSettingsHost,
  userId: number,
  settings: WorkplaceSettings | undefined,
): readonly ScriptParam[] {
  const script = host.script(workScriptId(host, userId, settings))
  return script ? scriptParams(script.source) : []
}

/**
 * The params of a script run by a workplace's settings as it reads them (`CONTEXT.md`:
 * Workplace settings): the resident's own value, their override, else the workplace's setting
 * while it fits the param's type, else none, which reads the default. `workplace` unpicked is
 * the workplace itself.
 */
export function withWorkSettings<P extends ScriptParam & { value?: ScriptParamValue }>(
  params: readonly P[],
  workplaceId: string,
  settings: WorkplaceSettings | undefined,
): P[] {
  return params.map((p) => {
    if (p.value !== undefined) return p
    if (p.name === WORKPLACE_PARAM && p.type === 'building') return { ...p, value: workplaceId }
    const value = settings?.params?.[p.name]
    const fits = p.type === 'number' ? isParamNumber(value) : typeof value === 'string'
    return fits ? { ...p, value: value! } : p
  })
}

/**
 * Gives a resident Work at a workplace by its settings (`CONTEXT.md`: Workplace settings): they
 * run work script `scriptId` from `memory`, Work's (`TaskMemory`), their earlier kept values for
 * it dropped. What they keep then is the workplace in `workplace` when the realm may name it
 * (`target`, as a task fills its target param), and the values the Player changed in the form
 * before it started, their overrides; null keeps nothing. It ends whatever they were doing.
 */
export function startWorkBySettings(
  r: Resident,
  scriptId: number,
  memory: TaskMemory['work'],
  overrides?: StartParamValues,
  target?: string,
): void {
  r.order = null
  r.script = { scriptId, memory: { ...memory }, settingsFrom: memory.workplaceId }
  dropKept(r, scriptId)
  const kept: StartParamValues = {}
  for (const [name, value] of Object.entries(overrides ?? {}))
    if (value !== null && name !== WORKPLACE_PARAM) kept[name] = value
  if (target !== undefined) kept[WORKPLACE_PARAM] = target
  setStartParams(r, scriptId, kept)
}

/** Drops the values a resident keeps for a script. */
function dropKept(r: Resident, scriptId: number): void {
  if (!r.scriptParams?.[scriptId]) return
  delete r.scriptParams[scriptId]
  if (Object.keys(r.scriptParams).length === 0) delete r.scriptParams
}

/**
 * Switches everyone the realm commands who works the workplace by its settings, and runs another
 * script than its work script now, to that one, as if given Work there again (`CONTEXT.md`:
 * Workplace settings); a script a defence script interrupted too, which goes on as the new one.
 */
function switchWorkers(
  world: WorldState,
  host: WorkSettingsHost,
  userId: number,
  realmId: string,
  buildingId: string,
): void {
  const scriptId = workScriptId(host, userId, workSettingsOf(world, realmId, buildingId))
  const index = worldIndex(world)
  const stale = (s: RunningScript | undefined) =>
    s?.settingsFrom === buildingId && s.scriptId !== scriptId
  const workMemory = (s: RunningScript): TaskMemory['work'] => {
    const { makes } = s.memory
    return { workplaceId: buildingId, ...(typeof makes === 'string' ? { makes } : {}) }
  }
  // The workplace in `workplace`, as giving Work there fills it, while the realm may name it.
  const target = paramTarget(world, realmId, 'building', buildingId) ? buildingId : undefined
  for (const r of world.residents) {
    if (index.commanderOf(r) !== realmId) continue
    if (stale(r.script)) startWorkBySettings(r, scriptId, workMemory(r.script!), {}, target)
    const interrupted = r.interrupted
    if (interrupted?.script && stale(interrupted.script)) {
      const memory = workMemory(interrupted.script)
      interrupted.order = null
      interrupted.script = { scriptId, memory: { ...memory }, settingsFrom: buildingId }
      dropKept(r, scriptId)
      if (target !== undefined) setStartParams(r, scriptId, { [WORKPLACE_PARAM]: target })
    }
  }
}

interface SetWorkSettingsRequest extends OrderRequest {
  kind: 'setWorkSettings'
  buildingId: string
  /**
   * The work script to switch to, null for the Work default; left out it stays. Switching to
   * another one clears the values set, which were for the script before.
   */
  scriptId?: number | null
  /** Values for the work script's params by name, null clearing one; those left out keep theirs. */
  params?: StartParamValues
}

/**
 * The set-work-settings order (`CONTEXT.md`: Workplace settings): the Player sets, for a
 * workplace or site of a workplace kind their realm knows (its own, or one in sight or last
 * seen), its work script, values for that script's params, or both. Free and instant, from
 * anywhere; it changes nobody's order. The script must be one of theirs declaring
 * `param workplace: building`, or their Work default; each value must fit its param as a Run
 * script's would (`startParamsProblem`), and `workplace` is never set, being the building.
 */
export function setWorkSettingsOrder(host: WorkSettingsHost): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<SetWorkSettingsRequest>
      const realm = realmOf(world, sender.userId)
      if (!realm) return 'you have no realm'
      const b =
        typeof o.buildingId === 'string' ? worldIndex(world).buildingById(o.buildingId) : undefined
      if (!b || !takesWorkSettings(b) || !paramTarget(world, realm.id, 'building', b.id))
        return 'not a workplace or construction site of one you know'
      if (o.scriptId !== undefined && o.scriptId !== null) {
        const script = Number.isInteger(o.scriptId) ? host.script(o.scriptId) : undefined
        if (!script || script.userId !== sender.userId)
          return 'not one of your scripts with a version that can run'
        if (script.task !== 'work' && !isWorkScript(scriptParams(script.source)))
          return `not a work script: it declares no \`param ${WORKPLACE_PARAM}: building\``
      }
      if (o.params === undefined) return undefined
      if (typeof o.params === 'object' && o.params !== null && WORKPLACE_PARAM in o.params)
        return `${WORKPLACE_PARAM}: is the workplace itself`
      const now = workSettingsOf(world, realm.id, b.id)
      const next = o.scriptId === undefined ? now : { scriptId: o.scriptId ?? undefined }
      const declared = workScriptParams(host, sender.userId, next)
      return startParamsProblem(world, realm.id, declared, o.params)
    },
    apply(world, sender, order) {
      const { buildingId, scriptId, params } = order as SetWorkSettingsRequest
      const realm = realmOf(world, sender.userId)
      if (!realm) return
      const all = world.workplaceSettings[realm.id] ?? {}
      const settings: WorkplaceSettings = { ...all[buildingId] }
      if (scriptId !== undefined) {
        // Their Work default is kept as none: it is what a workplace without settings runs.
        const id =
          scriptId === null || host.script(scriptId)?.task === 'work' ? undefined : scriptId
        if (id !== settings.scriptId) delete settings.params
        if (id === undefined) delete settings.scriptId
        else settings.scriptId = id
      }
      const values = { ...settings.params }
      for (const [name, value] of Object.entries(params ?? {})) {
        if (value === null) delete values[name]
        else values[name] = value
      }
      if (Object.keys(values).length > 0) settings.params = values
      else delete settings.params
      if (Object.keys(settings).length > 0) all[buildingId] = settings
      else delete all[buildingId]
      if (Object.keys(all).length > 0) world.workplaceSettings[realm.id] = all
      else delete world.workplaceSettings[realm.id]
      if (scriptId !== undefined) switchWorkers(world, host, sender.userId, realm.id, buildingId)
    },
  }
}

/**
 * Drops Workplace settings that no longer name anything, once a tick: those of a realm that is
 * gone, those of a building that is gone, and values naming a building or carriage that is gone.
 * A value naming something no longer the realm's stays, read as unset, like a resident's.
 */
export function stepWorkplaceSettings(world: WorldState): void {
  const index = worldIndex(world)
  for (const [realmId, all] of Object.entries(world.workplaceSettings)) {
    if (!world.realms.some((r) => r.id === realmId)) {
      delete world.workplaceSettings[realmId]
      continue
    }
    for (const [buildingId, settings] of Object.entries(all)) {
      const b = index.buildingById(buildingId)
      if (!b || !takesWorkSettings(b)) {
        delete all[buildingId]
        continue
      }
      for (const [name, value] of Object.entries(settings.params ?? {})) {
        const named =
          typeof value !== 'string' ||
          index.buildingById(value) !== undefined ||
          index.carriageById(value) !== undefined
        if (!named) delete settings.params![name]
      }
      if (settings.params && Object.keys(settings.params).length === 0) delete settings.params
      if (Object.keys(settings).length === 0) delete all[buildingId]
    }
    if (Object.keys(all).length === 0) delete world.workplaceSettings[realmId]
  }
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Workplace settings): settings are kept only by realms, only
 * for buildings there are that take them, each with a whole positive script id if any and values
 * that are plain ids or whole numbers of zero or more, never for `workplace`; no empty group is
 * left behind.
 */
export const workplaceSettingsSound: Invariant = {
  name: 'workplace-settings-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const index = worldIndex(world)
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    for (const [realmId, all] of Object.entries(world.workplaceSettings)) {
      if (!world.realms.some((r) => r.id === realmId))
        fail(`${realmId}, no realm, keeps workplace settings`, [])
      if (Object.keys(all).length === 0) fail(`realm ${realmId} keeps an empty group`, [])
      for (const [buildingId, settings] of Object.entries(all)) {
        const b = index.buildingById(buildingId)
        if (!b || !takesWorkSettings(b))
          fail(`realm ${realmId} keeps settings for ${buildingId}, no workplace`, [buildingId])
        if (Object.keys(settings).length === 0)
          fail(`realm ${realmId} keeps empty settings for ${buildingId}`, [buildingId])
        const { scriptId, params } = settings
        if (scriptId !== undefined && !(Number.isSafeInteger(scriptId) && scriptId > 0))
          fail(`realm ${realmId} keeps script ${scriptId} for ${buildingId}`, [buildingId])
        if (params === undefined) continue
        const values = Object.entries(params)
        if (values.length === 0)
          fail(`realm ${realmId} keeps an empty set of values for ${buildingId}`, [buildingId])
        if (WORKPLACE_PARAM in params)
          fail(`realm ${realmId} keeps a ${WORKPLACE_PARAM} value for ${buildingId}`, [buildingId])
        if (values.some(([, v]) => typeof v !== 'string' && !isParamNumber(v)))
          fail(`realm ${realmId} keeps a value for ${buildingId} that is no id or whole number`, [
            buildingId,
          ])
      }
    }
    return out
  },
}
