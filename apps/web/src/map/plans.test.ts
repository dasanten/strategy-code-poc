import { describe, expect, it } from 'vitest'
import type { BuildLine, LineOrder, Queue, SeenScript } from '@csp/shared'
import { plannedBuilding, plannedBuilds, plannedLines } from './plans.js'

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

describe('the Player’s planned buildings', () => {
  const buildOrder = (building: string, x: number, y: number, siteId: string | null = null) => ({
    kind: 'build',
    building,
    at: { x, y },
    siteId,
  })
  const buildStep = (building: string, x: number, y: number) => ({
    kind: 'task',
    task: 'build',
    building,
    at: { x, y },
  })
  const footprints = (plans: ReturnType<typeof plannedBuilding>) =>
    plans.footprints.map((f) => `${f.kind}:${f.x},${f.y}${f.strong ? '!' : ''}`).sort()

  it('ghosts the footprint of a Build step waiting in the queue, and of the current one', () => {
    const steps = [{ kind: 'walkTo', x: 1, y: 1 }, buildStep('house', 10, 12)]
    const waiting = resident('a', { queue: queue(steps) })
    const running = resident('b', { queue: queue([buildStep('farm', 20, 20)]) })
    const plans = plannedBuilding({ residents: [waiting, running], buildings: [], home, map }, [])
    expect(footprints(plans)).toEqual(['farm:20,20', 'house:10,12'])
  })

  it('ghosts the footprint of a Build order not laid out yet, and none once it has a site', () => {
    const ordered = resident('a', { order: buildOrder('storage', 5, 5) })
    const onSite = resident('b', { order: buildOrder('mine', 9, 9, 's1') })
    const plans = plannedBuilding({ residents: [ordered, onSite], buildings: [], home, map }, [])
    expect(footprints(plans)).toEqual(['storage:5,5'])
  })

  it('drops the ghost once a site or building of that kind stands there', () => {
    const r = resident('a', {
      queue: queue([buildStep('house', 10, 12), buildStep('house', 3, 3)]),
    })
    const buildings = [
      { kind: 'house', x: 10, y: 12 },
      // Another kind on the tile is no house: the house is still to build.
      { kind: 'storage', x: 3, y: 3 },
    ] as const
    expect(footprints(plannedBuilding({ residents: [r], buildings, home, map }, []))).toEqual([
      'house:3,3',
    ])
  })

  it('draws the picked residents’ builds strong, a build planned twice once', () => {
    const a = resident('a', { order: buildOrder('house', 4, 4) })
    const b = resident('b', { queue: queue([buildStep('house', 4, 4)]) })
    const other = { ...resident('x', { order: buildOrder('farm', 1, 1) }), owner: 'them' }
    const plans = plannedBuilding({ residents: [a, b, other], buildings: [], home, map }, ['b'])
    expect(footprints(plans)).toEqual(['house:4,4!'])
  })

  it('makes a single road or wall build a tile of the planned lines', () => {
    const r = resident('a', { queue: queue([buildStep('road', 2, 2), buildStep('wall', 3, 2)]) })
    const plans = plannedBuilding({ residents: [r], buildings: [], home, map }, [])
    expect(plans.footprints).toEqual([])
    expect(keys(plans)).toEqual(['road:2,2', 'wall:3,2'])
  })

  it('keeps a Build order a defence script interrupted, and skips steps with no kind or place', () => {
    const interrupted = { order: buildOrder('smithy', 7, 7) }
    const steps = [
      { kind: 'task', task: 'build', building: 'house' },
      { kind: 'task', task: 'build', building: 'castle', at: { x: 1, y: 1 } },
      { kind: 'task', task: 'work', at: { x: 1, y: 1 } },
    ]
    expect(plannedBuilds({ order: null, interrupted, queue: queue(steps) } as never)).toEqual([
      { kind: 'smithy', x: 7, y: 7 },
    ])
  })
})

describe('the Player’s planned Build lines', () => {
  const buildLine = (building: string, from: [number, number], to: [number, number]) => ({
    building,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
  })
  const running = (line: ReturnType<typeof buildLine>): SeenScript => ({
    scriptId: 0,
    task: 'buildLine',
    building: line.building as BuildLine['building'],
    line: line as BuildLine,
  })

  it('ghosts the tiles of a running Build line task, from its line’s two ends', () => {
    const r = resident('a', { script: running(buildLine('wall', [3, 4], [5, 4])) })
    expect(keys(plannedBuilding({ residents: [r], buildings: [], home, map }, []))).toEqual([
      'wall:3,4',
      'wall:4,4',
      'wall:5,4',
    ])
  })

  it('drops the tiles the crew has laid out or built, the picked one’s strong', () => {
    const line = buildLine('wall', [3, 4], [6, 4])
    const [a, b] = [
      resident('a', { script: running(line) }),
      resident('b', { script: running(line) }),
    ]
    const buildings = [
      { kind: 'wall', x: 3, y: 4 },
      { kind: 'wall', x: 5, y: 4 },
    ] as const
    expect(keys(plannedBuilding({ residents: [a, b], buildings, home, map }, ['b']))).toEqual([
      'wall:4,4!',
      'wall:6,4!',
    ])
  })

  it('ghosts a Build line step waiting in the queue, and not the running one twice', () => {
    const steps = [
      { kind: 'task', task: 'buildLine', ...buildLine('road', [1, 1], [2, 1]) },
      { kind: 'task', task: 'buildLine', ...buildLine('wall', [10, 10], [11, 11]) },
    ]
    const r = resident('a', {
      script: running(buildLine('road', [1, 1], [2, 1])),
      queue: queue(steps),
    })
    expect(plannedLines(r, size)).toEqual([
      {
        kind: 'road',
        tiles: [
          [1, 1],
          [2, 1],
        ],
      },
      {
        kind: 'wall',
        tiles: [
          [10, 10],
          [11, 11],
        ],
      },
    ])
  })

  it('keeps a Build line a defence script interrupted, and skips steps with no kind or ends', () => {
    const interrupted = { order: null, script: running(buildLine('road', [7, 7], [7, 8])) }
    const steps = [
      { kind: 'walkTo' },
      { kind: 'task', task: 'buildLine', ...buildLine('house', [1, 1], [2, 1]) },
      { kind: 'task', task: 'buildLine', building: 'wall', from: { x: 1, y: 1 } },
    ]
    expect(plannedLines({ order: null, interrupted, queue: queue(steps) } as never, size)).toEqual([
      {
        kind: 'road',
        tiles: [
          [7, 7],
          [7, 8],
        ],
      },
    ])
  })
})
