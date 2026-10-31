import { describe, expect, it } from 'vitest'
import { GLIDE_MS, Motion, type Token } from './motion.js'

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
