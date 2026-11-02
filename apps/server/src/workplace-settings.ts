import { scriptParams } from '@csp/lang'
import {
  WORKPLACE_PARAM,
  isParamNumber,
  isWorkScript,
  takesWorkSettings,
  type OrderRequest,
  type ScriptParam,
  type StartParamValues,
  type Task,
  type WorkplaceSettings,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { paramTarget, startParamsProblem } from './script-params.js'
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
 * The work script the settings name and its `param` lines: the Player's script while it is
 * still theirs and a work script, else their Work default.
 */
function workScriptParams(
  host: WorkSettingsHost,
  userId: number,
  settings: WorkplaceSettings | undefined,
): readonly ScriptParam[] {
  const picked = settings?.scriptId === undefined ? undefined : host.script(settings.scriptId)
  const script =
    picked && picked.userId === userId && isWorkScript(scriptParams(picked.source))
      ? picked
      : host.script(host.defaultScript(userId, 'work'))
  return script ? scriptParams(script.source) : []
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
