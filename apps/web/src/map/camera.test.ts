import { describe, expect, it } from 'vitest'
import {
  MAX_SCALE,
  centreBeside,
  chunkToScreen,
  minScale,
  panBy,
  screenToTile,
  tileToScreen,
  visibleChunks,
  zoomAt,
  type Camera,
} from './camera.js'

const view = { width: 800, height: 600 }
const size = 1440

describe('camera', () => {
  it('maps screen points to tiles and back', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    expect(screenToTile(cam, view, size, 400, 300)).toEqual([100, 200])
    expect(screenToTile(cam, view, size, 410, 280)).toEqual([101, 198])
    expect(tileToScreen(cam, view, size, 101, 198)).toEqual([410, 280])
  })

  it('centres a tile in the part of the screen left uncovered', () => {
    const cam = centreBeside(100, 200, { left: 0, right: 0 }, 10, size)
    expect(tileToScreen(cam, view, size, 100.5, 200.5)).toEqual([400, 300])
    // A drawer covers 400 px on the left: the tile shows in the middle of the 400 px beside it.
    const beside = centreBeside(100, 200, { left: 400, right: 0 }, 10, size)
    expect(beside.scale).toBe(10)
    expect(tileToScreen(beside, view, size, 100.5, 200.5)).toEqual([600, 300])
    // And a card covers 200 px on the right: the middle of 400..600.
    const between = centreBeside(100, 200, { left: 400, right: 200 }, 10, size)
    expect(tileToScreen(between, view, size, 100.5, 200.5)).toEqual([500, 300])
    // Across the west join the camera wraps onto the map.
    const west = centreBeside(0, 200, { left: 400, right: 0 }, 10, size)
    expect(west.x).toBeGreaterThan(size - 20)
    expect(tileToScreen(west, view, size, 0.5, 200.5)).toEqual([600, 300])
  })

  it('shows tiles across a join at their nearest copy', () => {
    // Looking at the west side: the east side's last tiles sit just to the left.
    const cam: Camera = { x: 2, y: 700, scale: 10 }
    expect(tileToScreen(cam, view, size, size - 3, 700)).toEqual([400 - 50, 300])
    expect(screenToTile(cam, view, size, 350, 300)).toEqual([size - 3, 700])
  })

  it('zooms around the point under the cursor and stays within limits', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    const zoomed = zoomAt(cam, view, size, 2, 600, 100)
    expect(zoomed.scale).toBe(20)
    expect(screenToTile(zoomed, view, size, 600, 100)).toEqual(
      screenToTile(cam, view, size, 600, 100),
    )
    expect(zoomAt(cam, view, size, 1000, 400, 300).scale).toBe(MAX_SCALE)
    // Never so far out that a tile would show twice.
    const out = zoomAt(cam, view, size, 0.0001, 400, 300)
    expect(out.scale).toBe(minScale(size, view))
    expect(view.width / out.scale).toBeLessThanOrEqual(size)
  })

  it('pans endlessly, coming back from the other side', () => {
    const cam: Camera = { x: 100, y: 200, scale: 10 }
    expect(panBy(cam, size, 50, -20)).toEqual({ x: 95, y: 202, scale: 10 })
    expect(panBy(cam, size, 1010, 0).x).toBe(size - 1)
    expect(panBy(cam, size, -size * 10, 0).x).toBeCloseTo(100)
  })

  it('lists the chunks on screen, across the joins too', () => {
    const n = size / 32
    // 800×600 px at 8 px per tile is 100×75 tiles around (320, 320): chunks 8–11 both ways.
    const chunks = visibleChunks({ x: 320, y: 320, scale: 8 }, view, size)
    expect(chunks).toHaveLength(16)
    expect(chunks).toContain(8 * n + 8)
    expect(chunks).toContain(11 * n + 11)
    // Around the corner where all four sides meet: chunks from every corner of the map.
    const corner = visibleChunks({ x: 0, y: 0, scale: 8 }, view, size)
    expect(corner).toEqual(expect.arrayContaining([0, n - 1, (n - 1) * n, (n - 1) * n + n - 1]))
    expect(chunkToScreen({ x: 0, y: 0, scale: 8 }, view, size, n - 1, 0)).toEqual([
      400 - 32 * 8,
      300,
    ])
  })
})
