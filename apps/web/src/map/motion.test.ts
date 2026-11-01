import { describe, expect, it } from 'vitest'
import { DIAGONAL_STEP, TICK_MS, type ResidentOrder } from '@csp/shared'
import {
  AHEAD_TICKS,
  EASE_MS,
  GLIDE_MS,
  Motion,
  motionTokens,
  WORK_SWAY,
  WORK_SWAY_MS,
  workSway,
  type Token,
} from './motion.js'

const token = (id: string, x: number, y: number): Token => ({ id, x, y })

/** A motion given a token at (5, 5) at time 0 and at `to` at time `at`. */
function stepped(to: [number, number], at = 1000) {
  const m = new Motion()
  m.update([token('a', 5, 5)], 0)
  m.update([token('a', ...to)], at)
  return m
}

describe('Motion (CONTEXT.md: Motion on the map)', () => {
  it('glides a token that stepped one tile over one tick: at 0, half and one tick', () => {
    const m = stepped([6, 5])
    expect(m.at('a', 6, 5, 1000)).toEqual([5, 5])
    expect(m.at('a', 6, 5, 1000 + GLIDE_MS / 2)).toEqual([5.5, 5])
    expect(m.at('a', 6, 5, 1000 + GLIDE_MS)).toEqual([6, 5])
    expect(m.at('a', 6, 5, 1000 + GLIDE_MS * 2)).toEqual([6, 5])
  })

  it('glides a diagonal step the same way', () => {
    const m = stepped([4, 6])
    expect(m.at('a', 4, 6, 1000 + GLIDE_MS / 4)).toEqual([4.75, 5.25])
  })

  it('wants frames while a token is on its way, and none after', () => {
    const m = stepped([6, 5])
    expect(m.moving(1000)).toBe(true)
    expect(m.moving(1000 + GLIDE_MS - 1)).toBe(true)
    expect(m.moving(1000 + GLIDE_MS)).toBe(false)
  })

  it('wants no frame for a state nobody moved in', () => {
    const m = new Motion()
    m.update([token('a', 5, 5)], 0)
    m.update([token('a', 5, 5)], 1000)
    expect(m.moving(1000)).toBe(false)
  })

  it('draws a token that jumped more than one tile in place', () => {
    const m = stepped([7, 5])
    expect(m.at('a', 7, 5, 1000 + GLIDE_MS / 2)).toEqual([7, 5])
    expect(m.moving(1000)).toBe(false)
  })

  it('draws a token that wrapped around the map edge in place', () => {
    const m = new Motion()
    m.update([token('a', 0, 5)], 0)
    m.update([token('a', 63, 5)], 1000)
    expect(m.at('a', 63, 5, 1000 + GLIDE_MS / 2)).toEqual([63, 5])
  })

  it('draws a token that just appeared in place', () => {
    const m = new Motion()
    m.update([token('a', 5, 5)], 0)
    m.update([token('a', 5, 5), token('b', 6, 5)], 1000)
    expect(m.at('b', 6, 5, 1000 + GLIDE_MS / 2)).toEqual([6, 5])
  })

  it('draws a token that was out of sight and came back in place', () => {
    const m = new Motion()
    m.update([token('a', 5, 5)], 0)
    m.update([], 1000)
    m.update([token('a', 6, 5)], 2000)
    expect(m.at('a', 6, 5, 2000 + GLIDE_MS / 2)).toEqual([6, 5])
  })

  it('leaves tokens that stood still in place while another glides', () => {
    const m = new Motion()
    m.update([token('a', 5, 5), token('b', 8, 8)], 0)
    m.update([token('a', 6, 5), token('b', 8, 8)], 1000)
    expect(m.at('b', 8, 8, 1000 + GLIDE_MS / 2)).toEqual([8, 8])
    expect(m.at('a', 6, 5, 1000 + GLIDE_MS / 2)).toEqual([5.5, 5])
  })

  it('starts the next step from the tile the last one ended on', () => {
    const m = stepped([6, 5])
    m.update([token('a', 7, 5)], 2000)
    expect(m.at('a', 7, 5, 2000)).toEqual([6, 5])
    expect(m.at('a', 7, 5, 2000 + GLIDE_MS / 2)).toEqual([6.5, 5])
  })

  it('a jump forgets a step still under way', () => {
    const m = stepped([6, 5])
    m.update([token('a', 20, 20)], 1500)
    expect(m.at('a', 20, 20, 1600)).toEqual([20, 20])
  })
})

describe('workSway (CONTEXT.md: Motion on the map)', () => {
  const at = { x: 5, y: 5 }
  const resident = (id: string, order: ResidentOrder | null) => ({
    id,
    order,
    carried: {},
    x: 5,
    y: 5,
    riding: undefined,
  })
  const working = (id: string) =>
    resident(id, { kind: 'workAt', buildingId: 'mine', at, progress: 0 })

  it('sways a resident at work over time, no more than a few pixels', () => {
    const r = working('r1')
    const seen = new Set<string>()
    for (let t = 0; t < WORK_SWAY_MS; t += WORK_SWAY_MS / 8) {
      const [dx, dy] = workSway(r, t)
      expect(Math.abs(dx)).toBeLessThanOrEqual(WORK_SWAY)
      expect(Math.abs(dy)).toBeLessThanOrEqual(WORK_SWAY)
      seen.add(`${dx.toFixed(4)},${dy.toFixed(4)}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('sways two residents of a crew out of step', () => {
    expect(workSway(working('r1'), 300)).not.toEqual(workSway(working('r2'), 300))
  })

  it('comes round again after one sway', () => {
    const [dx, dy] = workSway(working('r1'), 300)
    const [ex, ey] = workSway(working('r1'), 300 + WORK_SWAY_MS)
    expect(ex).toBeCloseTo(dx)
    expect(ey).toBeCloseTo(dy)
  })

  it('keeps a resident standing about still', () => {
    expect(workSway(resident('r1', null), 300)).toEqual([0, 0])
  })

  it('keeps a walking resident still: they glide instead', () => {
    const walk: ResidentOrder = { kind: 'walkTo', target: { x: 9, y: 9 }, path: [], progress: 0 }
    expect(workSway(resident('r1', walk), 300)).toEqual([0, 0])
  })
})

describe('Motion.gliding', () => {
  it('tells a token on its way from one standing still', () => {
    const m = new Motion()
    m.update([token('a', 5, 5), token('b', 8, 8)], 0)
    m.update([token('a', 6, 5), token('b', 8, 8)], 1000)
    expect(m.gliding('a', 1000 + GLIDE_MS / 2)).toBe(true)
    expect(m.gliding('a', 1000 + GLIDE_MS)).toBe(false)
    expect(m.gliding('b', 1000 + GLIDE_MS / 2)).toBe(false)
  })
})

/** A token at (x, y) on its way along `path`, `progress` tiles into the first step. */
const going = (
  id: string,
  x: number,
  y: number,
  path: [number, number][],
  progress: number,
): Token => ({ id, x, y, way: { path, progress } })

/** States 0..ticks, one a tick, of a walker going east from (5, 5) at `pace` tiles a tick. */
function walkEast(ticks: number, pace = 0.25) {
  const m = new Motion()
  for (let i = 0; i <= ticks; i++) {
    const d = (i + 1) * pace
    const x = 5 + Math.floor(d)
    const path: [number, number][] = [
      [x + 1, 5],
      [x + 2, 5],
      [x + 3, 5],
    ]
    m.update([going('a', x, 5, path, d - Math.floor(d))], i * TICK_MS)
  }
  return m
}

describe('Motion along the way (CONTEXT.md: Motion on the map)', () => {
  it('keeps a walker on slow ground moving between ticks, a step taking four', () => {
    const m = walkEast(2)
    // At tick 2 the walker is 0.75 into the step from (5, 5), going a quarter tile a tick.
    for (const f of [0, 0.25, 0.5, 0.75]) {
      expect(m.at('a', 5, 5, (2 + f) * TICK_MS)[0]).toBeCloseTo(5.75 + 0.25 * f)
    }
    expect(m.moving(2.5 * TICK_MS)).toBe(true)
    expect(m.gliding('a', 2.5 * TICK_MS)).toBe(true)
  })

  it('goes on at an even pace when the next state arrives on time', () => {
    const m = walkEast(2)
    const drawn = m.at('a', 5, 5, 3 * TICK_MS)
    // Tick 3: the step is done, the walker on (6, 5) at the start of the next.
    m.update([going('a', 6, 5, [[7, 5]], 0)], 3 * TICK_MS)
    expect(m.at('a', 6, 5, 3 * TICK_MS)).toEqual(drawn)
    expect(m.at('a', 6, 5, 3.5 * TICK_MS)[0]).toBeCloseTo(6.125)
  })

  it('carries on across a tile edge between ticks', () => {
    const m = walkEast(2, 0.75)
    // At tick 2 it is a quarter into the step from (7, 5); half a tick later 0.375 further.
    expect(m.at('a', 7, 5, 2.5 * TICK_MS)[0]).toBeCloseTo(7.625)
    expect(m.at('a', 7, 5, 3 * TICK_MS)[0]).toBeCloseTo(8)
    expect(m.at('a', 7, 5, 3.2 * TICK_MS)[0]).toBeGreaterThan(8)
  })

  it('goes a diagonal step at its length', () => {
    const m = new Motion()
    m.update([going('a', 5, 5, [[6, 6]], 0)], 0)
    m.update([going('a', 5, 5, [[6, 6]], 0.5)], TICK_MS)
    // Eased by then: half a tile into a step of DIAGONAL_STEP, and half a tile a tick since.
    const [x, y] = m.at('a', 5, 5, TICK_MS + EASE_MS)
    const f = (0.5 + 0.5 * (EASE_MS / TICK_MS)) / DIAGONAL_STEP
    expect(x).toBeCloseTo(5 + f)
    expect(y).toBeCloseTo(5 + f)
  })

  it('waits for the next state a little past the tick, and wants no frames after', () => {
    const m = walkEast(2)
    const far = m.at('a', 5, 5, (2 + AHEAD_TICKS) * TICK_MS)
    expect(m.at('a', 5, 5, (2 + AHEAD_TICKS + 3) * TICK_MS)).toEqual(far)
    expect(m.moving((2 + AHEAD_TICKS) * TICK_MS)).toBe(false)
  })

  it('stops at the end of its way', () => {
    const m = new Motion()
    m.update([going('a', 5, 5, [[6, 5]], 0.5)], 0)
    m.update([going('a', 6, 5, [[7, 5]], 0.5)], TICK_MS)
    expect(m.at('a', 6, 5, 2.4 * TICK_MS)[0]).toBeCloseTo(7)
  })

  it('eases a token that stopped back to its tile', () => {
    const m = walkEast(2)
    const ahead = m.at('a', 5, 5, 3 * TICK_MS)[0]
    // Tick 3: still on (5, 5), its order ended.
    m.update([token('a', 5, 5)], 3 * TICK_MS)
    expect(m.at('a', 5, 5, 3 * TICK_MS)[0]).toBeCloseTo(ahead)
    const mid = m.at('a', 5, 5, 3 * TICK_MS + EASE_MS / 2)[0]
    expect(mid).toBeGreaterThan(5)
    expect(mid).toBeLessThan(ahead)
    expect(m.at('a', 5, 5, 3 * TICK_MS + EASE_MS)).toEqual([5, 5])
    expect(m.moving(3 * TICK_MS + EASE_MS)).toBe(false)
  })

  it('eases a token that turned onto its new way, keeping its pace', () => {
    const m = walkEast(2)
    const [ax, ay] = m.at('a', 5, 5, 3 * TICK_MS)
    // Tick 3: it turned south on (5, 5), its new way just found.
    m.update([going('a', 5, 5, [[5, 6]], 0)], 3 * TICK_MS)
    const [bx, by] = m.at('a', 5, 5, 3 * TICK_MS)
    expect(bx).toBeCloseTo(ax)
    expect(by).toBeCloseTo(ay)
    const [x, y] = m.at('a', 5, 5, 3 * TICK_MS + EASE_MS)
    expect(x).toBeCloseTo(5)
    expect(y).toBeCloseTo(5 + 0.25 * (EASE_MS / TICK_MS))
  })

  it('draws a token that jumped off its way in place', () => {
    const m = walkEast(2)
    m.update([going('a', 20, 20, [[21, 20]], 0)], 3 * TICK_MS)
    expect(m.at('a', 20, 20, 3 * TICK_MS)).toEqual([20, 20])
  })

  it('waits at the map edge rather than run across the map, and is in place over it', () => {
    const m = new Motion()
    m.update([going('a', 63, 5, [[0, 5]], 0.5)], 0)
    expect(m.at('a', 63, 5, TICK_MS / 2)).toEqual([63, 5])
    m.update([going('a', 0, 5, [[1, 5]], 0.5)], TICK_MS)
    expect(m.at('a', 0, 5, TICK_MS)).toEqual([0.5, 5])
  })
})

describe('motionTokens', () => {
  const walk = (path: [number, number][] | null): ResidentOrder => ({
    kind: 'walkTo',
    target: { x: 9, y: 9 },
    path,
    progress: 0.5,
  })
  const resident = (id: string, order: ResidentOrder | null, more: object = {}) =>
    ({ id, x: 5, y: 5, order, ...more }) as never

  it('gives a walker their way and one standing none', () => {
    const [a, b] = motionTokens({
      residents: [resident('a', walk([[6, 5]])), resident('b', null)],
      horses: [],
      carriages: [],
    })
    expect(a!.way).toEqual({ path: [[6, 5]], progress: 0.5 })
    expect(b!.way).toBeUndefined()
  })

  it('gives no way to a fetch order taking goods, nor while the path is being found', () => {
    const fetch: ResidentOrder = {
      kind: 'fetch',
      goods: {},
      from: { kind: 'storage', storageId: 's' },
      phase: 'taking',
      path: [[6, 5]],
      progress: 0,
    }
    const [a, b] = motionTokens({
      residents: [resident('a', fetch), resident('b', walk(null))],
      horses: [],
      carriages: [],
    })
    expect(a!.way).toBeUndefined()
    expect(b!.way).toBeUndefined()
  })

  it('moves a carriage, its horse and its passengers along the way its driver drives', () => {
    const drive: ResidentOrder = {
      kind: 'drive',
      carriageId: 'k',
      target: { x: 9, y: 9 },
      path: [[6, 5]],
      progress: 0.2,
    }
    const tokens = motionTokens({
      residents: [resident('d', drive), resident('p', null, { aboard: 'k' })],
      horses: [{ id: 'h', x: 5, y: 5 } as never],
      carriages: [{ id: 'k', x: 5, y: 5, horseId: 'h' } as never],
    })
    expect(tokens).toHaveLength(4)
    for (const t of tokens) expect(t.way, t.id).toEqual({ path: [[6, 5]], progress: 0.2 })
  })

  it('moves a ridden horse along the way of its rider', () => {
    const tokens = motionTokens({
      residents: [resident('r', walk([[6, 5]]), { riding: 'h' })],
      horses: [{ id: 'h', x: 5, y: 5 } as never],
      carriages: [],
    })
    expect(tokens.find((t) => t.id === 'h')!.way).toEqual({ path: [[6, 5]], progress: 0.5 })
  })
})
