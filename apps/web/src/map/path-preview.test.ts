import { describe, expect, it } from 'vitest'
import { Terrain } from '@csp/shared'
import { previewPath } from './path-preview.js'

const SIZE = 64

/** Ground from rows of letters, plains elsewhere: L lake, M mountain, R road, ? unexplored. */
const groundOf = (rows: string[], x0 = 0, y0 = 0) => {
  const letters: Record<string, Terrain | undefined> = {
    '.': Terrain.Plains,
    L: Terrain.Lake,
    M: Terrain.Mountain,
    R: Terrain.Road,
    F: Terrain.Forest,
    '?': undefined,
  }
  return (x: number, y: number): Terrain | undefined => {
    const c = rows[y - y0]?.[x - x0]
    return c === undefined ? Terrain.Plains : letters[c]
  }
}

describe('the way a pick previews', () => {
  it('goes straight over open plains, without the start', () => {
    const path = previewPath(SIZE, { x: 0, y: 0 }, { x: 4, y: 0 }, groundOf([]))
    expect(path).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ])
    expect(previewPath(SIZE, { x: 2, y: 2 }, { x: 2, y: 2 }, groundOf([]))).toEqual([])
  })

  it('goes round a lake, never cutting a corner', () => {
    const ground = groundOf(['.....', '..L..', '..L..', '..L..', '.....'])
    const path = previewPath(SIZE, { x: 0, y: 2 }, { x: 4, y: 2 }, ground)
    expect(path.at(-1)).toEqual([4, 2])
    for (const [x, y] of path) expect(ground(x, y)).not.toBe(Terrain.Lake)
    // Each diagonal step has both straight tiles beside it passable.
    let [px, py] = [0, 2]
    for (const [x, y] of path) {
      if (x !== px && y !== py) {
        expect(ground(x, py)).not.toBe(Terrain.Lake)
        expect(ground(px, y)).not.toBe(Terrain.Lake)
      }
      ;[px, py] = [x, y]
    }
  })

  it('takes a road when it is quicker, as the server would', () => {
    // Mountain between, a road round it, a lake below.
    const ground = groundOf(['RRRRR', 'RMMMR', 'RMMMR', 'LLLLL'])
    const path = previewPath(SIZE, { x: 0, y: 2 }, { x: 4, y: 2 }, ground)
    for (const [x, y] of path) expect(ground(x, y)).toBe(Terrain.Road)
  })

  it('goes round a wall to its gate', () => {
    // A wall all along x = 2, its gate at y = 4.
    const blocked = (x: number, y: number) => x === 2 && y !== 4
    const path = previewPath(SIZE, { x: 0, y: 0 }, { x: 4, y: 0 }, groundOf([]), 'foot', blocked)
    expect(path).toContainEqual([2, 4])
    for (const [x, y] of path) expect(blocked(x, y)).toBe(false)
  })

  it('runs straight over unexplored ground, which counts as plains', () => {
    const ground = groundOf(['?????', '?????'])
    expect(previewPath(SIZE, { x: 0, y: 0 }, { x: 4, y: 0 }, ground)).toHaveLength(4)
  })

  it('keeps a carriage off mountains', () => {
    const ground = groundOf(['.....', '..M..', '..M..', '..M..', '.....'], 0, 0)
    const driving = previewPath(SIZE, { x: 0, y: 2 }, { x: 4, y: 2 }, ground, 'carriage')
    expect(driving.some(([x, y]) => ground(x, y) === Terrain.Mountain)).toBe(false)
  })

  it('draws a straight line to a place it can’t reach', () => {
    const ground = groundOf(['..L..'])
    expect(previewPath(SIZE, { x: 0, y: 0 }, { x: 2, y: 0 }, ground)).toEqual([
      [1, 0],
      [2, 0],
    ])
  })

  it('goes the short way across the map’s join', () => {
    const path = previewPath(SIZE, { x: SIZE - 1, y: 0 }, { x: 1, y: 0 }, groundOf([]))
    expect(path).toEqual([
      [0, 0],
      [1, 0],
    ])
  })
})
