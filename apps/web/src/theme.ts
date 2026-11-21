/**
 * The colours of the pixel art (EDG32), named as `ui.css` of the Pixel frontier design names them
 * (`docs/design/pixel-frontier/`, ADR 0044). Every UI colour below is one of these.
 */
const EDG32 = {
  ink: '#181425',
  night: '#262b44',
  slate: '#3a4466',
  steel: '#5a6988',
  fog: '#8b9bb4',
  mist: '#c0cbdc',
  bark: '#3e2731',
  wood: '#733e39',
  clay: '#b86f50',
  tan: '#e4a672',
  parch: '#ead4aa',
  paper: '#f6e9c9',
  gold: '#feae34',
  sun: '#fee761',
  orange: '#f77622',
  red: '#e43b44',
  blood: '#a22633',
  grass: '#63c74d',
  leaf: '#3e8948',
  pine: '#265c42',
  navy: '#124e89',
  sky: '#0099db',
  cyan: '#2ce8f5',
} as const

/**
 * The game's look in one place (ADR 0044: Pixel frontier, parchment panels with hard edges in the
 * pixel art's palette). The CSS reads these as custom properties (`applyTheme`); the map reads
 * them through `palette.ts`.
 */
export const THEME = {
  font: {
    /** Everything a Player reads or presses. */
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    /** Amounts, tiles, clocks, keys and scripts. */
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    /** Names, panel titles and big numbers. */
    pixel: "'Pixelify Sans', 'Courier New', monospace",
  },
  /** The pixel art's palette, as `--ink`, `--parch`, `--gold`… for the kit (`styles/kit.css`). */
  palette: EDG32,
  /** HUD colours: parchment panels, dark wood bars. */
  ui: {
    /** The darkest tone: edges, the page behind the map, text on gold. */
    ink: EDG32.ink,
    /** Bars: the top bar, the tool rail, the realm bar. */
    bar: EDG32.bark,
    /** Drawers, the card and dialogs. */
    panel: EDG32.parch,
    /** Inputs. */
    well: '#fffaf0',
    /** Code: the script editor and code blocks. */
    code: EDG32.night,
    /** Buttons and hovered rows. */
    raised: EDG32.paper,
    raisedHover: EDG32.tan,
    line: EDG32.tan,
    lineStrong: EDG32.clay,
    text: EDG32.bark,
    muted: EDG32.wood,
    live: EDG32.pine,
    /** A warning's mark: a meter, a row's edge. */
    warn: EDG32.gold,
    /** A warning in words, readable on parchment. */
    warnText: EDG32.blood,
    bad: EDG32.blood,
    /** Text on the dark bars. */
    barText: EDG32.parch,
    barMuted: EDG32.mist,
  },
  /**
   * Who a thing belongs to, seen from the Player (ADR 0008, 0044): the colour of a token's ring
   * and of the mark beside anything the HUD names an owner by. There is no enemy colour: there is
   * no war, only standing.
   */
  relationship: {
    own: EDG32.gold,
    alliance: EDG32.sky,
    otherRealm: EDG32.red,
    npcCity: EDG32.fog,
    tradeOrg: EDG32.cyan,
  },
  /**
   * The same relationships as words on parchment, where the bright colours above don't read
   * (a contrast of at least 4.5:1, see `contrast`).
   */
  relationshipText: {
    own: EDG32.wood,
    alliance: EDG32.navy,
    otherRealm: EDG32.blood,
    npcCity: EDG32.slate,
    tradeOrg: EDG32.pine,
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
    /** Explored terrain on its way from the server: a neutral grey, not unexplored black. */
    loading: '#565d63',
    /** Behind the map, where nothing is explored. */
    void: '#0b0d0f',
  },
} as const

export type Relationship = keyof typeof THEME.relationship

/** A theme colour as Pixi wants it: `#rrggbb` to 0xrrggbb. */
export function hex(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Not a #rrggbb colour: ${color}`)
  return parseInt(color.slice(1), 16)
}

/** A `#rrggbb` colour's relative luminance (WCAG 2). */
function luminance(color: string): number {
  const value = hex(color)
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

/** The contrast ratio of two `#rrggbb` colours (WCAG 2), 1 to 21; text wants 4.5 or more. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** "otherRealm" to "other-realm", for CSS names. */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * The theme as CSS custom properties: the palette as `--ink`, `--gold`…, the rest by group:
 * `--font-ui`, `--ui-panel`, `--rel-own`, `--text-rel-own`, `--terrain-sea`…
 */
export function cssVariables(theme = THEME): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(theme.palette)) vars[`--${kebab(name)}`] = value
  const groups = {
    font: theme.font,
    ui: theme.ui,
    rel: theme.relationship,
    'text-rel': theme.relationshipText,
    terrain: theme.terrain,
  }
  for (const [prefix, group] of Object.entries(groups))
    for (const [name, value] of Object.entries(group)) vars[`--${prefix}-${kebab(name)}`] = value
  return vars
}

/** Sets the theme's custom properties on an element, normally the document root. */
export function applyTheme(style: Pick<CSSStyleDeclaration, 'setProperty'>) {
  for (const [name, value] of Object.entries(cssVariables())) style.setProperty(name, value)
}

/** The class that colours a HUD row or mark by who it belongs to: `rel-own`, `rel-other-realm`… */
export function relationshipClass(rel: Relationship): string {
  return `rel-${kebab(rel)}`
}
