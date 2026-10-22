/**
 * The game's look in one place (ADR 0008: bright board-game terrain, a clean "command table" HUD).
 * The CSS reads these as custom properties (`applyTheme`); the map reads them through `palette.ts`.
 */
export const THEME = {
  font: {
    ui: "'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: 'ui-monospace, Consolas, monospace',
  },
  /** HUD colours: dark translucent panels over the map. */
  ui: {
    /** The darkest tone: page background, text on light buttons. */
    ink: '#0e1419',
    /** Bars and the tool rail. */
    bar: 'rgba(14, 20, 25, 0.9)',
    /** Drawers, the inspector and dialogs. */
    panel: 'rgba(14, 20, 25, 0.92)',
    /** Inputs and code. */
    well: '#0a0f13',
    /** Buttons and hovered rows. */
    raised: 'rgba(255, 255, 255, 0.06)',
    raisedHover: 'rgba(255, 255, 255, 0.12)',
    line: 'rgba(255, 255, 255, 0.08)',
    lineStrong: 'rgba(255, 255, 255, 0.18)',
    text: '#e8eef4',
    muted: '#9aa7b4',
    live: '#4ade80',
    warn: '#f2b630',
    bad: '#ff6a48',
  },
  /**
   * Who a thing belongs to, seen from the Player (ADR 0008): the colour on a token's base and
   * anywhere the HUD names an owner. There is no enemy colour: there is no war, only standing.
   */
  relationship: {
    own: '#f2b630',
    alliance: '#4f9dff',
    otherRealm: '#ff6a48',
    npcCity: '#a89c8a',
    tradeOrg: '#2ec8b8',
  },
  /** Bright painted terrain (ADR 0008). */
  terrain: {
    plains: '#93c45a',
    forest: '#3f8c3c',
    hills: '#c9a65c',
    mountain: '#938f8a',
    lake: '#45aee0',
    sea: '#2f80c6',
    road: '#e8cf97',
    unexplored: '#1a1e22',
    /** Behind terrain not loaded yet. */
    void: '#0b0d0f',
  },
} as const

export type Relationship = keyof typeof THEME.relationship

/** A theme colour as Pixi wants it: `#rrggbb` to 0xrrggbb. */
export function hex(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Not a #rrggbb colour: ${color}`)
  return parseInt(color.slice(1), 16)
}

/** "otherRealm" to "other-realm", for CSS names. */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** The theme as CSS custom properties: `--font-ui`, `--ui-panel`, `--rel-own`, `--terrain-sea`… */
export function cssVariables(theme = THEME): Record<string, string> {
  const vars: Record<string, string> = {}
  const groups = { font: theme.font, ui: theme.ui, rel: theme.relationship, terrain: theme.terrain }
  for (const [prefix, group] of Object.entries(groups))
    for (const [name, value] of Object.entries(group)) vars[`--${prefix}-${kebab(name)}`] = value
  return vars
}

/** Sets the theme's custom properties on an element, normally the document root. */
export function applyTheme(style: Pick<CSSStyleDeclaration, 'setProperty'>) {
  for (const [name, value] of Object.entries(cssVariables())) style.setProperty(name, value)
}
