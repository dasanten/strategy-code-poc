import { describe, expect, it } from 'vitest'
import { roadJoins } from './roads.js'

const joinsOf = (tiles: [number, number][]) => {
  const roads = new Set(tiles.map(([x, y]) => `${x},${y}`))
  const isRoad = (x: number, y: number) => roads.has(`${x},${y}`)
  return tiles.flatMap(([x, y]) => roadJoins(x, y, isRoad).map(([dx, dy]) => [x, y, dx, dy]))
}

describe('roadJoins', () => {
  it('joins a straight line to its neighbours, each join once', () => {
    expect(
      joinsOf([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toEqual([
      [0, 0, 1, 0],
      [1, 0, 1, 0],
    ])
  })

  it('joins a diagonal line of roads corner to corner', () => {
    expect(
      joinsOf([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toEqual([
      [0, 0, 1, 1],
      [1, 1, 1, 1],
    ])
    expect(
      joinsOf([
        [2, 0],
        [1, 1],
        [0, 2],
      ]),
    ).toEqual([
      [2, 0, -1, 1],
      [1, 1, -1, 1],
    ])
  })

  it('draws an L-corner with no diagonal joint', () => {
    for (const l of [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [1, 0],
        [0, 0],
        [0, 1],
      ],
    ] as [number, number][][]) {
      expect(joinsOf(l).filter(([, , dx, dy]) => dx !== 0 && dy !== 0)).toEqual([])
    }
  })

  it('leaves a road alone with no joins', () => {
    expect(
      joinsOf([
        [0, 0],
        [2, 0],
        [0, 2],
      ]),
    ).toEqual([])
  })
})
