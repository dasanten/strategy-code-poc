/**
 * How the map is drawn (`CONTEXT.md`: Art style, ADR 0047): line art tokens only, the painted
 * sprites over them, or Daniel's pixel art with the painted look for whatever isn't drawn yet.
 * The Player picks it in the legend; it is remembered per browser.
 */
export type ArtStyle = 'tokens' | 'painted' | 'pixel'

export const ART_STYLES: readonly ArtStyle[] = ['tokens', 'painted', 'pixel']

/** The styles as the legend names them. */
export const ART_STYLE_NAMES: Record<ArtStyle, string> = {
  tokens: 'Tokens',
  painted: 'Painted',
  pixel: 'Pixel',
}

/** The style of a browser that has picked none (`CONTEXT.md`: Art style): Pixel. */
export const DEFAULT_ART_STYLE: ArtStyle = 'pixel'

const ART_STYLE_KEY = 'csp.artStyle'

const isArtStyle = (v: unknown): v is ArtStyle => ART_STYLES.includes(v as ArtStyle)

/** The style this browser remembers; the default when it has none. */
export function rememberedArtStyle(
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): ArtStyle {
  try {
    const kept = storage().getItem(ART_STYLE_KEY)
    if (isArtStyle(kept)) return kept
  } catch {
    // Storage can be off (a private window); the map then just draws in the default style.
  }
  return DEFAULT_ART_STYLE
}

/** Remembers the style in this browser, if it lets us. */
export function rememberArtStyle(
  style: ArtStyle,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(ART_STYLE_KEY, style)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

let current: ArtStyle | undefined
const listeners = new Set<() => void>()

/** The style the map draws in now. */
export function artStyle(): ArtStyle {
  current ??= rememberedArtStyle()
  return current
}

/** Picks the style: remembered, and everything drawn in it is told to draw again. */
export function setArtStyle(style: ArtStyle): void {
  if (style === artStyle()) return
  current = style
  rememberArtStyle(style)
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the style changes; the returned function stops it. */
export function onArtStyle(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
