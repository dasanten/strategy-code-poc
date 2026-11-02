import { DEFAULT_SCRIPTS, type ScriptSummary, type Task } from '@csp/shared'
import { WIKI_PATH } from './wiki-view.js'

/**
 * What a new script starts from in the Library (`CONTEXT.md`: Script, Default script): empty, a
 * copy of one of the Player's default scripts, or one of the Wiki's example scripts, which are
 * the game's defaults (`DEFAULT_SCRIPTS`, the same source the Wiki shows).
 */
export type ScriptTemplate =
  | { kind: 'empty' }
  | { kind: 'mine'; scriptId: number; task: Task }
  | { kind: 'example'; task: Task }

/** One choice of the template picker: its value, label and the group it is listed under. */
export interface TemplateChoice {
  value: string
  label: string
  group: 'Start' | 'Your default scripts' | 'Example scripts (Wiki)'
  template: ScriptTemplate
}

/** What an empty script holds: a line saying how it runs. */
export const EMPTY_SCRIPT = '// Runs once a tick for each resident or army running it.\n'

/** The Wiki's Script language and Game API sections, which the editor links. */
export const SCRIPT_HELP_LINKS = [
  { href: `${WIKI_PATH}#language`, label: 'Script language' },
  { href: `${WIKI_PATH}#api`, label: 'Game API' },
] as const

/** The templates a new script can start from, empty first. */
export function templateChoices(scripts: readonly ScriptSummary[]): TemplateChoice[] {
  const empty: TemplateChoice = {
    value: 'empty',
    label: 'Empty',
    group: 'Start',
    template: { kind: 'empty' },
  }
  const mine = scripts
    .filter((s): s is ScriptSummary & { task: Task } => s.task !== null && s.activeVersion !== null)
    .map<TemplateChoice>((s) => ({
      value: `mine-${s.id}`,
      label: `Copy of your ${DEFAULT_SCRIPTS[s.task].name}`,
      group: 'Your default scripts',
      template: { kind: 'mine', scriptId: s.id, task: s.task },
    }))
  const examples = (Object.keys(DEFAULT_SCRIPTS) as Task[]).map<TemplateChoice>((task) => ({
    value: `example-${task}`,
    label: `${DEFAULT_SCRIPTS[task].name} (the game’s default)`,
    group: 'Example scripts (Wiki)',
    template: { kind: 'example', task },
  }))
  return [empty, ...mine, ...examples]
}

/**
 * The name a template prefills: none for an empty script, else "<name> copy" for the Player's
 * own default and "<name> example" for the Wiki's, numbered on when the library has it already
 * (names are unique in a library).
 */
export function templateName(template: ScriptTemplate, taken: readonly string[]): string {
  if (template.kind === 'empty') return ''
  const base =
    template.kind === 'mine'
      ? `${DEFAULT_SCRIPTS[template.task].name} copy`
      : `${DEFAULT_SCRIPTS[template.task].name} example`
  const used = new Set(taken.map((n) => n.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`
    if (!used.has(name.toLowerCase())) return name
  }
}

/** The source a template starts with; a copy of the Player's own needs it fetched, so none here. */
export function templateSource(template: ScriptTemplate): string | undefined {
  if (template.kind === 'empty') return EMPTY_SCRIPT
  if (template.kind === 'example') return DEFAULT_SCRIPTS[template.task].source
  return undefined
}
