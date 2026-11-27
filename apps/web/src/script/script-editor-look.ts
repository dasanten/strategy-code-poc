import { THEME } from '../ui/theme.js'

const p = THEME.palette

/**
 * The script editor's dark look, from the pixel art's palette (ADR 0044: Pixel frontier), as the
 * kit's `.code` blocks colour code: comments fog, keywords gold, strings grass, numbers cyan, on
 * the code ground. `ScriptEditor` hands these to CodeMirror; `script-editor-look.test.ts` keeps
 * the words readable on their grounds.
 */
export const EDITOR_LOOK = {
  /** Behind the code and the line numbers. */
  ground: THEME.ui.code,
  /** Names and everything else without a colour of its own. */
  text: p.mist,
  /** Line numbers and fold marks. */
  gutter: p.fog,
  /** The line the cursor is on: slate, half see-through, so a selection on it still shows. */
  activeLine: `${p.slate}80`,
  /** The selection, and the outline of the matching bracket's ground. */
  selection: p.slate,
  cursor: p.sun,
  comment: p.fog,
  keyword: p.gold,
  string: p.grass,
  number: p.cyan,
  /** `true`, `false` and `null`. */
  atom: p.cyan,
  operator: p.tan,
  /** A syntax error's underline and its edge in the hover; red, as a mark rather than words. */
  error: p.red,
  /** A warning's underline and edge; warnings never stop a version from running. */
  warning: p.gold,
  /** Hovers, completions and the lint's messages. */
  tooltip: { ground: p.ink, text: p.mist, edge: p.steel, muted: p.fog },
  /** The completion the arrow keys are on. */
  picked: { ground: p.navy, text: '#ffffff' },
  /** The typed part of a completion's name. */
  matched: p.sun,
} as const
