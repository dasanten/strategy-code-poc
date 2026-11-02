import {
  WORKPLACE_PARAM,
  isWorkScript,
  type ScriptParam,
  type ScriptSummary,
  type WorkplaceSettings,
} from '@csp/shared'

/**
 * What the Work settings panel on a workplace's card offers (`CONTEXT.md`: Workplace settings):
 * the scripts that can be its work script, which one it runs and the params it shows.
 */

/**
 * The scripts the Player can pick as a work script: their Work default first, then each of their
 * scripts declaring `param workplace: building`, by name as the library lists them.
 */
export function workScripts(scripts: readonly ScriptSummary[]): ScriptSummary[] {
  const workDefault = scripts.filter((s) => s.task === 'work')
  return [...workDefault, ...scripts.filter((s) => s.task !== 'work' && isWorkScript(s.params))]
}

/**
 * The work script the settings name: the Player's script while it still is one, else their Work
 * default. Undefined before the library has loaded.
 */
export function workScriptOf(
  scripts: readonly ScriptSummary[],
  settings: WorkplaceSettings | undefined,
): ScriptSummary | undefined {
  const all = workScripts(scripts)
  return all.find((s) => s.id === settings?.scriptId) ?? all.find((s) => s.task === 'work')
}

/** The params set on the card: all of the work script's but `workplace`, the building itself. */
export function workSettingsParams(
  script: Pick<ScriptSummary, 'params'> | undefined,
): ScriptParam[] {
  return script?.params.filter((p) => p.name !== WORKPLACE_PARAM) ?? []
}
