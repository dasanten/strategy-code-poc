import {
  ARMY_SCRIPT_API,
  SCRIPT_API,
  type ScriptBinding,
  type ScriptParamType,
} from './script-api.js'
import { SCRIPT_VIEWS, type ScriptType, type ScriptViewName } from './script-views.js'

/**
 * The game's side of the script checker (`checkNames` in `@csp/lang`; `CONTEXT.md`: Script
 * view): the API names a script gets and the shapes of the script views, in the checker's
 * terms. A script isn't typed as a resident's or an army's, so both APIs are in, and `me` holds
 * either; a default script (it has a task) runs only as a resident's and gets that API alone.
 */

/** What the checker knows of a value (`CheckedType` in `@csp/lang`). */
export type CheckedScriptType = 'unknown' | { list: CheckedScriptType } | { shape: string }

export interface ScriptCheckEnv {
  globals: Record<string, { type: CheckedScriptType; params?: readonly string[] }>
  shapes: Record<string, Record<string, CheckedScriptType>>
  describeShape: (shape: string) => string
  /** What `params.name` holds for each param type (`SCRIPT_PARAM_TYPES`). */
  paramTypes: Partial<Record<ScriptParamType, CheckedScriptType>>
}

/** The shape of `me` where it may be a resident or an army. */
export const RESIDENT_OR_ARMY = 'residentOrArmy'

/** A view's type as the checker knows it: views and lists of them; plain values aren't checked. */
function checked(type: ScriptType): CheckedScriptType {
  if (typeof type === 'string') return 'unknown'
  if ('list' in type) return { list: checked(type.list) }
  return { shape: type.view }
}

const same = (a: CheckedScriptType, b: CheckedScriptType) => JSON.stringify(a) === JSON.stringify(b)

/** The same name in both APIs: what both allow, and only what both agree on is certain. */
function merged(
  r: ScriptBinding,
  a: ScriptBinding,
): { type: CheckedScriptType; params?: readonly string[] } {
  const rType = checked(r.returns)
  const aType = checked(a.returns)
  const type = same(rType, aType)
    ? rType
    : r.name === 'me'
      ? { shape: RESIDENT_OR_ARMY }
      : 'unknown'
  if (r.is === 'value') return { type }
  const long = r.params.length >= a.params.length ? r.params : a.params
  const least = Math.min(
    ...[r.params, a.params].map((ps) => ps.filter((p) => !p.endsWith('?')).length),
  )
  // The longer list's names, those past the fewest either needs marked as optional.
  return { type, params: long.map((p, i) => (i >= least && !p.endsWith('?') ? `${p}?` : p)) }
}

const NOUNS: Partial<Record<string, string>> = {
  [RESIDENT_OR_ARMY]: 'a resident or an army',
  army: 'an army',
  stats: 'stats',
  skills: 'skills',
  goods: 'goods',
  residentOrder: 'a resident’s order',
  armyOrder: 'an army’s order',
  runningScript: 'a running script',
  lastSeen: 'a last-seen building or city',
  directiveGoal: 'a directive’s goal',
  site: 'a construction site’s progress',
  hire: 'an NPC city’s hire offer',
}

/** The names and shapes a script is checked against. */
export function scriptCheckEnv(options: { defaultScript: boolean }): ScriptCheckEnv {
  const shapes: ScriptCheckEnv['shapes'] = {}
  for (const [name, view] of Object.entries(SCRIPT_VIEWS)) {
    shapes[name] = Object.fromEntries(view.fields.map((f) => [f.name, checked(f.type)]))
  }
  const resident = shapes.resident!
  const army = shapes.army!
  shapes[RESIDENT_OR_ARMY] = Object.fromEntries(
    [...new Set([...Object.keys(resident), ...Object.keys(army)])].map((f) => {
      const r = resident[f]
      const a = army[f]
      return [f, r && a && !same(r, a) ? 'unknown' : (r ?? a)!]
    }),
  )

  const globals: ScriptCheckEnv['globals'] = {}
  const armyApi = new Map((options.defaultScript ? [] : ARMY_SCRIPT_API).map((b) => [b.name, b]))
  const entry = (b: ScriptBinding) => ({
    type: checked(b.returns),
    ...(b.is === 'value' ? {} : { params: b.params }),
  })
  for (const b of SCRIPT_API) {
    const a = armyApi.get(b.name)
    globals[b.name] = a ? merged(b, a) : entry(b)
    armyApi.delete(b.name)
  }
  for (const a of armyApi.values()) globals[a.name] = entry(a)

  return {
    globals,
    shapes,
    describeShape: (shape) => NOUNS[shape] ?? `a ${shape as ScriptViewName}`,
    // A storage param may hold a carriage as well, so only a building one is certain.
    paramTypes: { building: { shape: 'building' } },
  }
}
