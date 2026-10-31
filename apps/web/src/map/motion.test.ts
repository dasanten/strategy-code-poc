import { describe, expect, it } from 'vitest'
import type { ResidentOrder } from '@csp/shared'
import { GLIDE_MS, Motion, WORK_SWAY, WORK_SWAY_MS, workSway, type Token } from './motion.js'

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
