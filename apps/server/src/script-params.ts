import { scriptParams } from '@csp/lang'
import {
  commands,
  isParamNumber,
  isScriptParamType,
  targetParam,
  type Building,
  type Carriage,
  type OrderRequest,
  type Resident,
  type ScriptParam,
  type ScriptParamType,
  type ScriptParamValue,
  type StartParamValues,
  type WorldState,
} from '@csp/shared'
import { buildingOrganization, carriageOrganization } from './crimes.js'
import type { InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import type { RunnableScript } from './scripts.js'
import { realmOf } from './starting-city.js'

/**
 * Script parameters (`CONTEXT.md`: Script parameter): a script's `param name: type` lines, read
 * as `params.name`, and the values the Player picks for them on a resident's card, kept per
 * resident per script (`Resident.scriptParams`) as plain ids.
 */

/** The buildings a storage param may name besides carriages: those a store or fetch goes to. */
const STORAGE_KINDS: readonly string[] = ['storage', 'stable']

/**
 * What a param of `type` holding `id` names for the side (a realm, or an NPC city): one of its
 * own buildings or construction sites for `building`; one of its own finished storages or
 * stables, or one of its carriages, for `storage`. Undefined when the id names nothing of the
 * kind, or nothing of the side's.
 */
export function paramTarget(
  world: WorldState,
  side: string | undefined,
  type: Exclude<ScriptParamType, 'number'>,
  id: string,
): { is: 'building'; building: Building } | { is: 'carriage'; carriage: Carriage } | undefined {
  if (side === undefined) return undefined
  const b = world.buildings.find((x) => x.id === id)
  if (b) {
    if (buildingOrganization(world, b) !== side) return undefined
    if (type === 'storage' && (!STORAGE_KINDS.includes(b.kind) || b.site)) return undefined
    return { is: 'building', building: b }
  }
  if (type !== 'storage') return undefined
  const k = world.carriages.find((x) => x.id === id)
  return k && carriageOrganization(k) === side ? { is: 'carriage', carriage: k } : undefined
}

/**
 * The values picked for a resident's script as the script reads them, by the script's `param`
 * lines: the id or number picked for each, or none. Picked values of a param the script no
 * longer has, those that no longer fit its type, and ids naming something gone from the world
 * are dropped from the resident.
 */
export function paramValues(
  world: WorldState,
  r: Resident,
  scriptId: number,
  params: readonly ScriptParam[],
): (ScriptParam & { value?: ScriptParamValue })[] {
  const picked = r.scriptParams?.[scriptId]
  if (picked) {
    for (const [name, value] of Object.entries(picked)) {
      const param = params.find((p) => p.name === name)
      const fits =
        param?.type === 'number'
          ? isParamNumber(value)
          : param !== undefined &&
            typeof value === 'string' &&
            (world.buildings.some((b) => b.id === value) ||
              world.carriages.some((k) => k.id === value))
      if (!fits) delete picked[name]
    }
    if (Object.keys(picked).length === 0) delete r.scriptParams![scriptId]
    if (Object.keys(r.scriptParams!).length === 0) delete r.scriptParams
  }
  return params.map((p) => {
    const value = picked?.[p.name]
    return value === undefined ? { ...p } : { ...p, value }
  })
}

/** Why `value` can't be picked for `param` by the realm, if it can't: by the param's type. */
function valueProblem(
  world: WorldState,
  realmId: string,
  param: ScriptParam,
  value: unknown,
): string | undefined {
  if (!isScriptParamType(param.type)) return 'the script has no such param'
  if (param.type === 'number')
    return isParamNumber(value) ? undefined : 'must be a whole number of zero or more'
  if (typeof value !== 'string' || !paramTarget(world, realmId, param.type, value))
    return param.type === 'storage'
      ? 'must be a storage, a stable or a carriage of yours'
      : 'must be a building or construction site of yours'
  return undefined
}

/** Keeps `value` for the resident's param of the script, or with null clears it. */
function keep(r: Resident, scriptId: number, name: string, value: ScriptParamValue | null): void {
  if (value === null) {
    const picked = r.scriptParams?.[scriptId]
    if (!picked) return
    delete picked[name]
    if (Object.keys(picked).length === 0) delete r.scriptParams![scriptId]
    if (Object.keys(r.scriptParams!).length === 0) delete r.scriptParams
    return
  }
  r.scriptParams ??= {}
  r.scriptParams[scriptId] = { ...r.scriptParams[scriptId], [name]: value }
}

/**
 * Why the param values an order starting a script gives (`CONTEXT.md`: Script parameter, Before
 * it starts) don't fit the script's `param` lines, if they don't: each must name one of them and
 * fit its type, or be null.
 */
export function startParamsProblem(
  world: WorldState,
  realmId: string,
  declared: readonly ScriptParam[],
  params: unknown,
): string | undefined {
  if (params === undefined) return undefined
  if (typeof params !== 'object' || params === null || Array.isArray(params))
    return 'params must be values by name'
  for (const [name, value] of Object.entries(params)) {
    const param = declared.find((p) => p.name === name)
    if (!param) return `${name}: the script has no such param`
    if (value === null) continue
    const problem = valueProblem(world, realmId, param, value)
    if (problem) return `${name}: ${problem}`
  }
  return undefined
}

/**
 * Sets the param values an order starting script `scriptId` gives, before its first tick: each
 * one kept for the resident, null clearing it; those left out keep theirs.
 */
export function setStartParams(
  r: Resident,
  scriptId: number,
  params: StartParamValues | undefined,
): void {
  for (const [name, value] of Object.entries(params ?? {})) keep(r, scriptId, name, value)
}

/**
 * The param values a start sets, with the script's target param (`targetParam`; `CONTEXT.md`:
 * Default script, Started directly) never kept from the start before: `target`, else what the
 * order gives, else cleared, so the script works the one on the resident's tile. Only while the
 * script declares it.
 */
export function withTargetParam(
  script: Pick<RunnableScript, 'source' | 'task'> | undefined,
  params: StartParamValues | undefined,
  target?: string,
): StartParamValues | undefined {
  const name = script && targetParam(script)
  if (!name || !scriptParams(script.source).some((p) => p.name === name)) return params
  return { ...params, [name]: target ?? params?.[name] ?? null }
}

interface SetScriptParamRequest extends OrderRequest {
  kind: 'setScriptParam'
  residentId: string
  scriptId: number
  name: string
  /** The building or carriage picked; null clears it, for a `number` param too. */
  targetId?: string | null
  /** The whole number typed for a `number` param. */
  value?: number
}

/**
 * The set-script-param order (`CONTEXT.md`: Script parameter): the Player picks, or clears with
 * a null `targetId`, the value of a `param` of the script one of their residents runs. Free and
 * instant, from anywhere. The script must be the one the resident runs and have the param; the
 * target must fit its type and be the Player's, and a `number` param's `value` be a whole number
 * of zero or more.
 */
export function setScriptParamOrder(host: {
  script(scriptId: number): Pick<RunnableScript, 'userId' | 'source'> | undefined
}): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<SetScriptParamRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      if (!r.script || r.script.scriptId !== o.scriptId) return 'not the script they run'
      const script = host.script(o.scriptId)
      if (!script || script.userId !== sender.userId) return 'not the script they run'
      const param = scriptParams(script.source).find((p) => p.name === o.name)
      if (!param || !isScriptParamType(param.type)) return 'the script has no such param'
      if (o.targetId === null && o.value === undefined) return undefined
      if (param.type === 'number')
        return o.targetId === undefined
          ? valueProblem(world, realm.id, param, o.value)
          : 'must be a whole number of zero or more'
      if (o.value !== undefined) return 'takes no number'
      return valueProblem(world, realm.id, param, o.targetId)
    },
    apply(world, _sender, order) {
      const { residentId, scriptId, name, targetId, value } = order as SetScriptParamRequest
      const r = world.residents.find((x) => x.id === residentId)
      if (r) keep(r, scriptId, name, value ?? targetId!)
    },
  }
}

/**
 * Invariant (ADR 0004): every resident's picked script param values are plain ids or whole
 * numbers of zero or more, kept by a whole positive script id, with no empty group left behind.
 */
export function scriptParamsSound(world: WorldState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  for (const r of world.residents) {
    if (r.scriptParams === undefined) continue
    const fail = (message: string) =>
      out.push({
        invariant: 'script-params-sound',
        message: `resident ${r.id} ${message}`,
        entityIds: [r.id],
      })
    const groups = Object.entries(r.scriptParams)
    if (groups.length === 0) fail('keeps no script params, but an empty group')
    for (const [scriptId, picked] of groups) {
      if (!/^[1-9]\d*$/.test(scriptId)) fail(`keeps params for script ${scriptId}`)
      const values = Object.values(picked)
      if (values.length === 0) fail(`keeps an empty group of params for script ${scriptId}`)
      if (values.some((v) => typeof v !== 'string' && !isParamNumber(v)))
        fail(`keeps a param value of script ${scriptId} that is no id or whole number`)
    }
  }
  return out
}
