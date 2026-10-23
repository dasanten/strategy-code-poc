import { OVERVIEW_SCALE } from '@csp/shared'
import { TERRAIN_COLORS, VOID_COLOR } from './palette.js'

/*
 * The admin map's far terrain (`CONTEXT.md`: admin map): the whole map from the admin terrain
 * overview, one byte per `OVERVIEW_SCALE`² tiles, drawn instead of loading every chunk.
 */

/** How many overview bytes run along each side, from the overview itself (it is square). */
export const overviewSide = (overview: Uint8Array): number => Math.round(Math.sqrt(overview.length))

/** The overview as RGBA pixels, one per byte, row-major, each in its terrain's colour. */
export function overviewPixels(overview: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(overview.length * 4)
  overview.forEach((t, i) => {
    const c = TERRAIN_COLORS[t] ?? VOID_COLOR
    out[i * 4] = c >> 16
    out[i * 4 + 1] = (c >> 8) & 0xff
    out[i * 4 + 2] = c & 0xff
    out[i * 4 + 3] = 255
  })
  return out
}

/** The terrain the overview gives for a tile on the map. */
export function overviewTerrainAt(overview: Uint8Array, x: number, y: number): number | undefined {
  const side = overviewSide(overview)
  return overview[Math.floor(y / OVERVIEW_SCALE) * side + Math.floor(x / OVERVIEW_SCALE)]
}
