import { describe, expect, it } from 'vitest'
import { farRoadRuns, roadJoins } from './roads.js'

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

describe('farRoadRuns', () => {
  const size = 100
  const road = (x: number, y: number, site?: boolean) => ({
    kind: 'road',
    x,
    y,
    ...(site ? { site } : {}),
  })

  it('merges a straight road into one run and a corner into two', () => {
    const line = [road(10, 5), road(11, 5), road(12, 5), road(13, 5)]
    expect(farRoadRuns(line, size)).toEqual([{ x: 10, y: 5, dx: 1, dy: 0, n: 3 }])
    const corner = [road(0, 0), road(1, 0), road(1, 1), road(1, 2)]
    expect(farRoadRuns(corner, size)).toEqual([
      { x: 0, y: 0, dx: 1, dy: 0, n: 1 },
      { x: 1, y: 0, dx: 0, dy: 1, n: 2 },
    ])
  })

  it('joins diagonal roads corner to corner', () => {
    const diagonal = [road(5, 5), road(6, 6), road(7, 7)]
    expect(farRoadRuns(diagonal, size)).toEqual([{ x: 5, y: 5, dx: 1, dy: 1, n: 2 }])
  })

  it('leaves road sites out, and other buildings', () => {
    const roads = [
      road(0, 0),
      road(1, 0),
      road(2, 0, true),
      road(3, 0),
      { kind: 'house', x: 4, y: 0 },
    ]
    expect(farRoadRuns(roads, size)).toEqual([
      { x: 0, y: 0, dx: 1, dy: 0, n: 1 },
      // Cut off by the site, the last road stands alone.
      { x: 3, y: 0, dx: 0, dy: 0, n: 0 },
    ])
  })

  it('takes roads last seen with those in sight, once each', () => {
    const inSight = [road(0, 0), road(1, 0)]
    const lastSeen = [road(1, 0), road(2, 0)]
    expect(farRoadRuns([...inSight, ...lastSeen], size)).toEqual([
      { x: 0, y: 0, dx: 1, dy: 0, n: 2 },
    ])
  })

  it('runs across the map’s join', () => {
    expect(farRoadRuns([road(98, 3), road(99, 3), road(0, 3)], size)).toEqual([
      { x: 98, y: 3, dx: 1, dy: 0, n: 2 },
    ])
  })
})
