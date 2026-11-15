import { describe, expect, it } from 'vitest'
import { wallEdgeRects, wallEdgeWidth, wallSides } from './wall-tile.js'

const alone = { sx: 10, sy: 20, left: false, right: false, up: false, down: false }

describe('a wall tile’s drawing', () => {
  it('has an edge on every side while it stands alone, all inside the tile, at every zoom', () => {
    for (const tile of [4, 16, 48, 120]) {
      const rects = wallEdgeRects(alone, tile)
      expect(rects).toHaveLength(4)
      for (const [x, y, w, h] of rects) {
        expect(x).toBeGreaterThanOrEqual(10)
        expect(y).toBeGreaterThanOrEqual(20)
        expect(x + w).toBeLessThanOrEqual(10 + tile)
        expect(y + h).toBeLessThanOrEqual(20 + tile)
      }
      expect(wallEdgeWidth(tile)).toBeGreaterThan(0)
    }
  })

  it('draws no edge where it joins a neighbour, so wall tiles meet without a seam', () => {
    const rects = wallEdgeRects({ ...alone, right: true, down: true }, 40)
    expect(rects).toHaveLength(2)
    expect(wallEdgeRects({ ...alone, left: true, right: true, up: true, down: true }, 40)).toEqual(
      [],
    )
  })

  it('does not join across a corner: a diagonal pair keeps all its edges', () => {
    const walls = new Set(['1,1', '2,2'])
    const isWall = (x: number, y: number) => walls.has(`${x},${y}`)
    expect(wallSides(1, 1, isWall)).toEqual({ left: false, right: false, up: false, down: false })
  })

  it('finds the sides that touch', () => {
    const walls = new Set(['1,1', '2,1', '1,2'])
    const isWall = (x: number, y: number) => walls.has(`${x},${y}`)
    expect(wallSides(1, 1, isWall)).toEqual({ left: false, right: true, up: false, down: true })
  })
})
