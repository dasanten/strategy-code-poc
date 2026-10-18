import { describe, expect, it } from 'vitest'
import {
  MAX_SCALE,
  minScale,
  panBy,
  screenToTile,
  tileToScreen,
  visibleChunks,
  zoomAt,
  type Camera,
} from './camera.js'

const view = { width: 800, height: 600 }
const diameter = 1440

describe('camera', () => {
  it('maps screen points to tiles and back', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    expect(screenToTile(cam, view, 400, 300)).toEqual([100, 200])
    expect(screenToTile(cam, view, 410, 280)).toEqual([101, 198])
    expect(tileToScreen(cam, view, 101, 198)).toEqual([410, 280])
  })

  it('zooms around the point under the cursor and stays within limits', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    const zoomed = zoomAt(cam, view, diameter, 2, 600, 100)
    expect(zoomed.scale).toBe(20)
    expect(screenToTile(zoomed, view, 600, 100)).toEqual(screenToTile(cam, view, 600, 100))
    expect(zoomAt(cam, view, diameter, 1000, 400, 300).scale).toBe(MAX_SCALE)
    expect(zoomAt(cam, view, diameter, 0.0001, 400, 300).scale).toBe(minScale(diameter, view))
  })

  it('pans opposite to the drag and keeps the view over the map', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    expect(panBy(cam, diameter, 50, -20)).toEqual({ x: 95, y: 202, scale: 10 })
    expect(panBy(cam, diameter, 1e6, 0).x).toBe(0)
  })

  it('lists only the chunks on screen', () => {
    // 800×600 px at 8 px per tile is 100×75 tiles around (320, 320).
    const chunks = visibleChunks({ x: 320, y: 320, scale: 8 }, view, diameter)
    const n = 45
    // Tiles 270–370 across and 282–357 down: chunks 8–11 across, 8–11 down.
    expect(chunks).toHaveLength(16)
    expect(chunks[0]).toBe(8 * n + 8)
    expect(chunks.at(-1)).toBe(11 * n + 11)
    // Zoomed all the way out, every chunk is on screen.
    const all = visibleChunks({ x: 720, y: 720, scale: minScale(diameter, view) }, view, diameter)
    expect(all).toHaveLength(n * n)
  })
})
