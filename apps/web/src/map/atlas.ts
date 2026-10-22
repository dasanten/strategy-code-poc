import { CanvasSource, Rectangle, Texture } from 'pixi.js'
import { ART_FILES, artInUse } from './art.js'

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
  return new Map(files.map((f, i) => [f, new Texture({ source, frame: frame(i), label: f })]))
}

/** Frees the atlas's texture. */
export function destroyAtlas(atlas: Atlas) {
  atlas.values().next().value?.source.destroy()
}

/** An SVG as a loaded image at the atlas cell size; without a size some browsers draw it at 0. */
async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image()
  const sized = svg.replace('<svg ', `<svg width="${ATLAS_CELL}" height="${ATLAS_CELL}" `)
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`
  await img.decode()
  return img
}
