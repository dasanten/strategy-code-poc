// PROTOTYPE (T17.1, #203): throwaway. One line-art glyph per thing on the map, 24×24, drawn in
// `currentColor`. The shape says what a thing is; each style only changes the treatment around it.
import type { BuildingKind, ResourceKind } from '@csp/shared'
import type { Activity } from './scene.js'

export type GlyphName =
  | Exclude<BuildingKind, 'road'>
  | ResourceKind
  | 'person'
  | 'crown'
  | 'cart'
  | 'caravan'
  | 'horse'
  | 'banner'
  | 'pile'
  | 'castle'
  | Exclude<Activity, 'idle'>
  | 'code'
  | 'log'
  | 'shield'
  | 'scales'
  | 'scroll'

const F = 'fill="currentColor"'

export const GLYPHS: Record<GlyphName, string> = {
  townHall: `<path d="M4 21V10l8-5 8 5v11"/><path d="M9 21v-5h6v5"/><path d="M12 5V1.5l4 1.5-4 1.5"/><path d="M3 21h18"/>`,
  house: `<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>`,
  storage: `<rect x="4" y="6" width="16" height="14" rx="1"/><path d="M4 6l8 7 8-7M4 20l8-7 8 7"/>`,
  warehouse: `<path d="M2 10l10-6 10 6v10H2z"/><path d="M6 20v-6h12v6M6 17h12"/>`,
  wall: `<path d="M3 20V9h3v3h3V9h3v3h3V9h3v3h3V9h0v11z"/><path d="M3 15h18"/>`,
  gate: `<path d="M3 21V6h4v2h3V6h4v2h3V6h4v15"/><path d="M8 21v-6a4 4 0 0 1 8 0v6"/>`,
  farm: `<path d="M12 22V8"/><path d="M12 9c-3-1-4-3-4-6 3 0 4 2 4 6zM12 9c3-1 4-3 4-6-3 0-4 2-4 6z"/><path d="M12 14c-3-1-4-3-4-5 3 0 4 2 4 5zM12 14c3-1 4-3 4-5-3 0-4 2-4 5z"/><path d="M5 22h14"/>`,
  stable: `<path d="M7 4v8a5 5 0 0 0 10 0V4"/><path d="M5 4h4M15 4h4"/><circle cx="7" cy="8" r=".6" ${F}/><circle cx="17" cy="8" r=".6" ${F}/><path d="M3 21h18"/>`,
  mine: `<path d="M4 8c4-4 12-4 16 0"/><path d="M12 5.5L8 21"/><path d="M3 21h18"/>`,
  quarry: `<path d="M3 20l3-6h5l2 6z"/><path d="M12 14l2-5h5l2 11"/><path d="M8 9l2-5h4"/>`,
  lumberCamp: `<path d="M3 18h18v3H3z"/><path d="M14 3l-6 12"/><path d="M14 3c2 0 5 1 5 4l-4 1"/>`,
  smelter: `<path d="M5 21V9h14v12"/><path d="M9 21v-4a3 3 0 0 1 6 0v4"/><path d="M15 9V3h3v6"/><path d="M12 15c-1-1 0-2 0-3 1 1 2 2 0 3z" ${F}/>`,
  mint: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5v5"/>`,
  smithy: `<path d="M3 11h13c0 3-2 4-4 4H7z"/><path d="M8 15l-1 5h8l-1-5"/><path d="M16 11h5l-2 2"/><path d="M17 3l3 3-4 3"/>`,
  forest: `<path d="M12 2l6 9h-3l4 6H5l4-6H6z"/><path d="M12 17v5"/>`,
  stone: `<path d="M3 19l3-7 5-2 3 3 2-1 5 7z"/><path d="M11 10l1 4-3 5"/>`,
  ironOre: `<path d="M4 17l2-8 7-4 7 5-2 9H8z"/><circle cx="10" cy="11" r="1.4" ${F}/><circle cx="14" cy="15" r="1.4" ${F}/><circle cx="15" cy="10" r="1" ${F}/>`,
  goldOre: `<path d="M4 18l3-7 6-2 6 4-1 6H7z"/><path d="M19 3v4M17 5h4M7 3v2M6 4h2"/><circle cx="12" cy="14" r="1.6" ${F}/>`,
  person: `<circle cx="12" cy="6" r="3.2" ${F}/><path d="M6 22c0-6 2.5-10 6-10s6 4 6 10z" ${F}/>`,
  crown: `<path d="M3 18l1-11 5 5 3-7 3 7 5-5 1 11z" ${F}/>`,
  cart: `<path d="M2 8h15v7H4z"/><path d="M17 10h5"/><circle cx="7" cy="18" r="3"/><circle cx="7" cy="18" r=".8" ${F}/>`,
  caravan: `<path d="M2 11h15v5H4z"/><path d="M4 11c0-5 11-5 11 0"/><path d="M17 13h5"/><circle cx="7" cy="19" r="2.6"/><circle cx="14" cy="19" r="2.6"/>`,
  horse: `<path d="M6 21v-7c0-4 3-7 7-8l1-3 1 3c3 1 5 3 5 6h-3l-2-2-1 3 1 8"/><circle cx="16" cy="8" r=".6" ${F}/>`,
  banner: `<path d="M6 22V2"/><path d="M6 3h13l-3 4 3 4H6z" ${F}/>`,
  pile: `<path d="M6 21c-2 0-3-2-2-4l3-6h10l3 6c1 2 0 4-2 4z"/><path d="M8 11c0-2 1-3 1-5h6c0 2 1 3 1 5"/><path d="M9 6h6"/>`,
  castle: `<path d="M3 21V8h3v2h2V8h3v13M13 21V8h3v2h2V8h3v13"/><path d="M8 4h8v6"/><path d="M8 4v6"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/><path d="M2 21h20"/>`,
  walk: `<path d="M4 12h14M13 6l6 6-6 6"/>`,
  carry: `<rect x="5" y="9" width="14" height="11" rx="1"/><path d="M9 9V5h6v4"/>`,
  work: `<path d="M14 4l6 6-3 3-6-6z"/><path d="M12 9l-8 8 3 3 8-8"/>`,
  fight: `<path d="M4 4l16 16M20 4L4 20"/><path d="M3 9l6-6M15 21l6-6"/>`,
  code: `<path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>`,
  log: `<path d="M5 3h11l3 3v15H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>`,
  shield: `<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M12 6v12M7 11h10"/>`,
  scales: `<path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-3 7a3 3 0 0 0 6 0zM20 7l-3 7a3 3 0 0 0 6 0z"/>`,
  scroll: `<path d="M6 4h12v14a2 2 0 0 1-2 2H6"/><path d="M6 4a2 2 0 0 0 0 4h2M6 20a2 2 0 0 1 0-4h10"/><path d="M10 8h6M10 12h6"/>`,
}

/** A glyph as an SVG image source, in one colour and stroke width. */
export function glyphSvg(name: GlyphName, color: string, stroke = 2): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" ` +
    `fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" ` +
    `stroke-linejoin="round" color="${color}">${GLYPHS[name]}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const cache = new Map<string, HTMLImageElement>()

/** A loaded image of a glyph, cached; draws nothing until loaded (the caller redraws on load). */
export function glyphImage(
  name: GlyphName,
  color: string,
  stroke: number,
  onLoad: () => void,
): HTMLImageElement {
  const key = `${name}|${color}|${stroke}`
  let img = cache.get(key)
  if (!img) {
    img = new Image()
    img.onload = onLoad
    img.src = glyphSvg(name, color, stroke)
    cache.set(key, img)
  }
  return img
}
