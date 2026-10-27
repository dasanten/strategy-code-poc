import { scriptParams } from '@csp/lang'
import {
  commands,
  isScriptParamType,
  type Building,
  type Carriage,
  type OrderRequest,
  type Resident,
  type ScriptParam,
  type ScriptParamType,
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
  type: ScriptParamType,
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
 * lines: the id picked for each, or none. Picked values of a param the script no longer has,
 * and those naming something gone from the world, are dropped from the resident.
 */
export function paramValues(
  world: WorldState,
  r: Resident,
  scriptId: number,
  params: readonly ScriptParam[],
): { name: string; type: ScriptParamType; id?: string }[] {
  const picked = r.scriptParams?.[scriptId]
  if (picked) {
    for (const [name, id] of Object.entries(picked)) {
      const gone =
        !world.buildings.some((b) => b.id === id) && !world.carriages.some((k) => k.id === id)
      if (gone || !params.some((p) => p.name === name)) delete picked[name]
    }
    if (Object.keys(picked).length === 0) delete r.scriptParams![scriptId]
    if (Object.keys(r.scriptParams!).length === 0) delete r.scriptParams
  }
  return params.map((p) => {
    const id = picked?.[p.name]
    return id === undefined ? { ...p } : { ...p, id }
  })
}

interface SetScriptParamRequest extends OrderRequest {
  kind: 'setScriptParam'
  residentId: string
  scriptId: number
  name: string
  /** The building or carriage picked; null clears it. */
  targetId: string | null
}

/**
 * The set-script-param order (`CONTEXT.md`: Script parameter): the Player picks, or clears with
 * a null `targetId`, the value of a `param` of the script one of their residents runs. Free and
 * instant, from anywhere. The script must be the one the resident runs and have the param; the
 * target must fit its type and be the Player's.
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
      if (o.targetId === null) return undefined
      if (typeof o.targetId !== 'string' || !paramTarget(world, realm.id, param.type, o.targetId))
        return param.type === 'storage'
          ? 'must be a storage, a stable or a carriage of yours'
          : 'must be a building or construction site of yours'
      return undefined
    },
    apply(world, _sender, order) {
      const { residentId, scriptId, name, targetId } = order as SetScriptParamRequest
      const r = world.residents.find((x) => x.id === residentId)
      if (!r) return
      if (targetId === null) {
        const picked = r.scriptParams?.[scriptId]
        if (!picked) return
        delete picked[name]
        if (Object.keys(picked).length === 0) delete r.scriptParams![scriptId]
        if (Object.keys(r.scriptParams!).length === 0) delete r.scriptParams
        return
      }
      r.scriptParams ??= {}
      r.scriptParams[scriptId] = { ...r.scriptParams[scriptId], [name]: targetId }
    },
  }
}

/**
 * Invariant (ADR 0004): every resident's picked script param values are plain ids, kept by a
 * whole positive script id, with no empty group left behind.
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
      if (values.some((v) => typeof v !== 'string'))
        fail(`keeps a param value of script ${scriptId} that is no id`)
    }
  }
  return out
}
