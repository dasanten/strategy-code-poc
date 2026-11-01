import { describe, expect, it } from 'vitest'
import type { LineOrder, Queue } from '@csp/shared'
import { plannedBuilding, plannedLines } from './plans.js'

const size = 100
const home = { realmId: 'me' }
const map = { size }

const wallLine = (tiles: [number, number][]): LineOrder => ({
  kind: 'wallLine',
  tiles,
  phase: 'walking',
  path: null,
  progress: 0,
  siteId: null,
})

const queue = (orders: object[], current = 0, loop = false): Queue => ({
  realmId: 'me',
  steps: orders.map((order, id) => ({ id, order: order as never })),
  current,
  startedAt: 0,
  loop,
  nextStepId: orders.length,
})

const resident = (id: string, more: object = {}) => ({
  id,
  owner: 'me',
  order: null,
  ...more,
})

const keys = (plans: ReturnType<typeof plannedBuilding>) =>
  plans.lines.map((t) => `${t.kind}:${t.x},${t.y}${t.strong ? '!' : ''}`).sort()

describe('the Player’s planned roads and walls', () => {
  it('ghosts the tiles still to build of a running line order', () => {
    const r = resident('a', {
      order: wallLine([
        [3, 4],
        [4, 4],
        [5, 4],
      ]),
    })
    expect(keys(plannedBuilding({ residents: [r], buildings: [], home, map }, []))).toEqual([
      'wall:3,4',
      'wall:4,4',
      'wall:5,4',
    ])
  })

  it('ghosts the tiles of a line step waiting in the queue, from its two end tiles', () => {
    const steps = [
      { kind: 'walkTo', x: 1, y: 1 },
      { kind: 'roadLine', from: { x: 10, y: 10 }, to: { x: 12, y: 12 } },
    ]
    const r = resident('a', { queue: queue(steps) })
    expect(keys(plannedBuilding({ residents: [r], buildings: [], home, map }, []))).toEqual([
      'road:10,10',
      'road:11,11',
      'road:12,12',
    ])
  })

  it('leaves out tiles that already have a site or a finished one, a gate counting as wall', () => {
    const r = resident('a', {
      order: wallLine([
        [3, 4],
        [4, 4],
        [5, 4],
        [6, 4],
      ]),
    })
    const buildings = [
      { kind: 'wall', x: 3, y: 4 },
      { kind: 'gate', x: 4, y: 4 },
      // A road there is no wall: the wall still goes on it.
      { kind: 'road', x: 5, y: 4 },
    ] as const
    expect(keys(plannedBuilding({ residents: [r], buildings, home, map }, []))).toEqual([
      'wall:5,4',
      'wall:6,4',
    ])
  })

  it('draws the picked residents’ plans strong, a tile planned twice once', () => {
    const a = resident('a', {
      order: wallLine([
        [1, 1],
        [2, 1],
      ]),
    })
    const b = resident('b', {
      order: wallLine([
        [2, 1],
        [3, 1],
      ]),
    })
    expect(keys(plannedBuilding({ residents: [a, b], buildings: [], home, map }, ['b']))).toEqual([
      'wall:1,1',
      'wall:2,1!',
      'wall:3,1!',
    ])
  })

  it('shows only the Player’s own residents’ plans', () => {
    const other = { ...resident('x', { order: wallLine([[1, 1]]) }), owner: 'them' }
    expect(plannedBuilding({ residents: [other], buildings: [], home, map }, []).lines).toEqual([])
  })
})

describe('the lines a resident is on or has queued', () => {
  const line = (x: number) => ({ kind: 'wallLine', from: { x, y: 0 }, to: { x, y: 0 } })

  it('takes the queue’s steps after the current one, and in a loop those before it too', () => {
    const steps = [line(1), line(2), line(3)]
    const xs = (q: Queue) =>
      plannedLines({ order: null, queue: q }, size).map((l) => l.tiles[0]![0])
    expect(xs(queue(steps, 1))).toEqual([3])
    expect(xs(queue(steps, 1, true))).toEqual([3, 1])
  })

  it('keeps a line a defence script interrupted, which goes on after it', () => {
    const interrupted = { order: wallLine([[7, 7]]) }
    expect(plannedLines({ order: null, interrupted }, size)).toEqual([
      { kind: 'wall', tiles: [[7, 7]] },
    ])
  })

  it('skips a step that is no line, or whose end tiles are missing', () => {
    const steps = [{ kind: 'walkTo' }, { kind: 'wallLine' }, { kind: 'roadLine', from: { x: 1 } }]
    expect(
      plannedLines({ order: null, queue: queue([{ kind: 'walkTo' }, ...steps]) }, size),
    ).toEqual([])
  })
})
