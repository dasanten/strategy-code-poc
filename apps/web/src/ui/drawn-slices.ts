import { PIXEL_FILES, isDrawn, pixelArt, type PixelSheet, type SliceRect } from '../map/pixel-art.js'
import { PIXEL_SLICES } from '../map/pixel-slices.js'

/**
 * Which slices of the sheets the UI draws from (the UI icons and the goods) have something drawn
 * in them, by atlas key (`pixelArt`): an empty slice shows its fallback instead (`docs/art.md`:
 * Pixel art). Read from the sheets once, the first time something asks; undefined until then.
 */
const UI_SHEETS: readonly PixelSheet[] = ['ui', 'goods', 'units', 'resident']

let drawn: ReadonlySet<string> | undefined
let loading = false
const listeners = new Set<() => void>()

/** A sheet's pixels; undefined if it can't be read. */
async function sheetPixels(sheet: PixelSheet) {
  const url = PIXEL_FILES[`${sheet}.png`]
  if (!url) return undefined
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.drawImage(img, 0, 0)
  return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width }
}

function load() {
  if (loading || typeof document === 'undefined') return
  loading = true
  void Promise.all(UI_SHEETS.map((s) => sheetPixels(s).catch(() => undefined)))
    .then((read) => {
      const found = new Set<string>()
      UI_SHEETS.forEach((sheet, i) => {
        const art = read[i]
        if (!art) return
        const slices = PIXEL_SLICES[sheet].slices as Readonly<Record<string, SliceRect>>
        for (const [slice, rect] of Object.entries(slices))
          if (isDrawn(art.pixels, art.width, rect)) found.add(pixelArt(sheet, slice))
      })
      return found
    })
    .catch(() => new Set<string>())
    .then((found) => {
      drawn = found
      listeners.forEach((l) => l())
    })
}

/** For `useSyncExternalStore`: starts reading the sheets and calls `listener` once they are. */
export function onDrawnSlices(listener: () => void): () => void {
  listeners.add(listener)
  load()
  return () => listeners.delete(listener)
}

/** The drawn slices by atlas key; undefined while the sheets are still being read. */
export const drawnSlices = (): ReadonlySet<string> | undefined => drawn
