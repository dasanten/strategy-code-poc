import { CanvasSource, Rectangle, Texture } from 'pixi.js'
import {
  ART_FILES,
  PAINTED_FILES,
  PAINTED_SHEET,
  artInUse,
  paintedCell,
  paintedCellsInUse,
} from './art.js'

/** Pixels per symbol in the atlas: enough for the largest token at the closest zoom. */
export const ATLAS_CELL = 96
/** Empty pixels around each symbol, so scaled-down neighbours don't bleed into each other. */
const PAD = 2

/** The map's art rasterised once, by file name (`art.ts`). */
export type Atlas = ReadonlyMap<string, Texture>

/** How symbols sit in the atlas: columns of cells in a square power-of-two canvas. */
export function atlasLayout(count: number, cell = ATLAS_CELL) {
  const stride = cell + 2 * PAD
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
  const size = 2 ** Math.ceil(Math.log2(columns * stride))
  const frame = (i: number) =>
    new Rectangle((i % columns) * stride + PAD, Math.floor(i / columns) * stride + PAD, cell, cell)
  return { columns, size, frame }
}

/**
 * Rasterises every SVG the registry points to into one texture (ADR 0008), with mipmaps so tokens
 * stay smooth when drawn small.
 */
export async function loadAtlas(): Promise<Atlas> {
  const files = artInUse()
  const { size, frame } = atlasLayout(files.length)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const images = await Promise.all(files.map((f) => svgImage(ART_FILES[f]!)))
  images.forEach((img, i) => {
    const { x, y, width, height } = frame(i)
    ctx.drawImage(img, x, y, width, height)
  })
  const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true })
  const atlas = new Map<string, Texture>(
    files.map((f, i) => [f, new Texture({ source, frame: frame(i), label: f })]),
  )
  await addPaintedSheet(atlas)
  return atlas
}

/** How far from magenta a pixel may be and still count as background. */
const KEY_TOLERANCE = 90

/**
 * Cuts the painted sheet (`art.ts`) into its cells, each its own texture, with the magenta made
 * transparent and the pink taken out of the edges it bled into.
 */
async function addPaintedSheet(atlas: Map<string, Texture>) {
  const url = PAINTED_FILES[PAINTED_SHEET.file]
  if (!url) return
  const img = new Image()
  img.src = url
  await img.decode()
  const cell = img.naturalWidth / PAINTED_SHEET.columns
  const side = Math.floor(cell)
  for (const i of paintedCellsInUse()) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = side
    const ctx = canvas.getContext('2d')!
    const x = (i % PAINTED_SHEET.columns) * cell
    const y = Math.floor(i / PAINTED_SHEET.columns) * cell
    ctx.drawImage(img, x, y, cell, cell, 0, 0, side, side)
    const pixels = ctx.getImageData(0, 0, side, side)
    const d = pixels.data
    for (let p = 0; p < d.length; p += 4) {
      const [r, g, b] = [d[p]!, d[p + 1]!, d[p + 2]!]
      const dist = Math.hypot(r - 255, g, b - 255)
      if (dist < KEY_TOLERANCE)
        d[p + 3] = Math.round(255 * Math.max(0, dist / KEY_TOLERANCE - 0.5) * 2)
      // Despill: magenta is red and blue above green; take the excess out.
      const spill = Math.min(r, b) - g
      if (spill > 0) {
        d[p] = r - spill
        d[p + 2] = b - spill
      }
    }
    ctx.putImageData(pixels, 0, 0)
    const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true })
    atlas.set(paintedCell(i), new Texture({ source, label: paintedCell(i) }))
  }
}

/** Frees the atlas's texture. */
export function destroyAtlas(atlas: Atlas) {
  for (const source of new Set([...atlas.values()].map((t) => t.source))) source.destroy()
}

/** An SVG as a loaded image at the atlas cell size; without a size some browsers draw it at 0. */
async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image()
  const sized = svg.replace('<svg ', `<svg width="${ATLAS_CELL}" height="${ATLAS_CELL}" `)
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`
  await img.decode()
  return img
}
