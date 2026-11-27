import { CanvasSource, Rectangle, Texture } from 'pixi.js'
import {
  ART_FILES,
  PAINTED_BUILDING_IMAGE,
  PAINTED_FILES,
  PAINTED_SHEET,
  artInUse,
  paintedCell,
  paintedCellsInUse,
  paintedImage,
} from './art.js'
import {
  PIXEL_FILES,
  isDrawn,
  packSlices,
  pixelArt,
  pixelTint,
  type PixelSheet,
  type SliceRect,
} from './pixel-art.js'
import { PIXEL_SLICES } from './pixel-slices.js'

/** Pixels per symbol in the atlas: enough for the largest token at the closest zoom. */
const ATLAS_CELL = 96
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
  await addPaintedImages(atlas)
  await addPixelArt(atlas)
  return atlas
}

/** How many pixels of its own edge surround each pixel art slice in the atlas. */
const PIXEL_PAD = 8
/** How wide the pixel art's texture is; its slices are packed in rows. */
const PIXEL_ATLAS_WIDTH = 512

/** An exported sheet's image as a canvas with its pixels, if the file is there. */
async function sheetPixels(file: string) {
  const url = PIXEL_FILES[file]
  if (!url) return undefined
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { canvas, width: canvas.width, pixels: data }
}

/**
 * Adds the pixel art (`pixel-art.ts`, ADR 0047): every slice with something drawn in it, and the
 * part of it on the sheet's tint layer, packed into one texture. It is drawn crisp when scaled up
 * and smooth when scaled down, each slice with its own edge repeated around it so that pieces
 * that join, like walls and roads, show no seam.
 */
async function addPixelArt(atlas: Map<string, Texture>) {
  const cuts: { key: string; from: HTMLCanvasElement; rect: SliceRect }[] = []
  for (const name of Object.keys(PIXEL_SLICES) as PixelSheet[]) {
    const sheet = PIXEL_SLICES[name]
    const art = await sheetPixels(`${name}.png`)
    if (!art) continue
    const tint = sheet.tint ? await sheetPixels(`${name}-tint.png`) : undefined
    for (const [slice, rect] of Object.entries(sheet.slices) as [string, SliceRect][]) {
      const key = pixelArt(name, slice)
      if (isDrawn(art.pixels, art.width, rect)) cuts.push({ key, from: art.canvas, rect })
      if (tint && isDrawn(tint.pixels, tint.width, rect))
        cuts.push({ key: pixelTint(key), from: tint.canvas, rect })
    }
  }
  if (cuts.length === 0) return
  const packed = packSlices(
    cuts.map((c) => [c.rect[2], c.rect[3]] as const),
    PIXEL_ATLAS_WIDTH,
    PIXEL_PAD,
  )
  const canvas = document.createElement('canvas')
  canvas.width = packed.width
  canvas.height = packed.height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const P = PIXEL_PAD
  cuts.forEach(({ from, rect: [sx, sy, w, h] }, i) => {
    const [x, y] = packed.at[i]!
    // The edge rows and columns and the corner pixels stretched outwards, then the slice itself.
    ctx.drawImage(from, sx, sy, w, 1, x, y - P, w, P)
    ctx.drawImage(from, sx, sy + h - 1, w, 1, x, y + h, w, P)
    ctx.drawImage(from, sx, sy, 1, h, x - P, y, P, h)
    ctx.drawImage(from, sx + w - 1, sy, 1, h, x + w, y, P, h)
    ctx.drawImage(from, sx, sy, 1, 1, x - P, y - P, P, P)
    ctx.drawImage(from, sx + w - 1, sy, 1, 1, x + w, y - P, P, P)
    ctx.drawImage(from, sx, sy + h - 1, 1, 1, x - P, y + h, P, P)
    ctx.drawImage(from, sx + w - 1, sy + h - 1, 1, 1, x + w, y + h, P, P)
    ctx.drawImage(from, sx, sy, w, h, x, y, w, h)
  })
  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    magFilter: 'nearest',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  })
  cuts.forEach(({ key, rect }, i) => {
    const [x, y] = packed.at[i]!
    const frame = new Rectangle(x, y, rect[2], rect[3])
    atlas.set(key, new Texture({ source, frame, label: key }))
  })
}

/** Adds the painted images that are files of their own (`PAINTED_BUILDING_IMAGE`), each a texture. */
async function addPaintedImages(atlas: Map<string, Texture>) {
  for (const file of Object.values(PAINTED_BUILDING_IMAGE)) {
    const url = PAINTED_FILES[file]
    if (!url) continue
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true })
    const key = paintedImage(file)
    atlas.set(key, new Texture({ source, label: key }))
  }
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
