import { describe, expect, it } from 'vitest'
import { chunksAcross } from '../shared/terrain.js'
import { visibleChunks } from './camera.js'
import { KEPT_TEXTURES, ShownTextures } from './shown-textures.js'

/**
 * Textures over a fake painter: each paint takes `paintMs` on a clock of its own and makes a
 * texture named after the chunk and how many times it was painted.
 */
function textures({ cap = 3, budgetMs = 4, paintMs = 0 } = {}) {
  let clock = 0
  const painted: number[] = []
  const dropped: string[] = []
  const times = new Map<number, number>()
  const t = new ShownTextures<string>(
    {
      paint: (i) => {
        clock += paintMs
        painted.push(i)
        const n = (times.get(i) ?? 0) + 1
        times.set(i, n)
        return `${i}#${n}`
      },
      drop: (_, texture) => dropped.push(texture),
    },
    cap,
    budgetMs,
    () => clock,
  )
  return { t, painted, dropped }
}

describe('ShownTextures', () => {
  it('paints a chunk only once it is on screen, and once', () => {
    const { t, painted } = textures()
    // Loaded off screen: nothing is painted for it.
    t.show([])
    expect(t.has(7)).toBe(false)
    expect(t.show([7])).toBe(false)
    expect(t.texture(7)).toBe('7#1')
    t.show([7])
    expect(painted).toEqual([7])
  })

  it('over the cap lets go of the least recently shown, never one on screen, and paints it again when shown', () => {
    const { t, dropped } = textures({ cap: 2 })
    t.show([1])
    t.show([2])
    t.show([1, 3])
    // 2 was shown least recently.
    expect(dropped).toEqual(['2#1'])
    expect([t.has(1), t.has(2), t.has(3)]).toEqual([true, false, true])
    // On screen all at once, more than the cap are kept while they are shown.
    t.show([4, 5, 6])
    expect([4, 5, 6].every((i) => t.has(i))).toBe(true)
    expect(t.size).toBe(3)
    t.show([2])
    expect(t.texture(2)).toBe('2#2')
    expect(t.size).toBe(2)
  })

  it('paints again a changed chunk only while it is on screen', () => {
    const { t, painted, dropped } = textures()
    t.show([1, 2])
    t.changed(1)
    t.changed(2)
    t.show([1])
    expect(t.texture(1)).toBe('1#2')
    expect(dropped).toEqual(['1#1'])
    // Off screen its old texture stays, unpainted, until it is shown.
    expect(t.texture(2)).toBe('2#1')
    expect(painted).toEqual([1, 2, 1])
    t.show([2])
    expect(t.texture(2)).toBe('2#2')
  })

  it('keeps to the frame budget when many chunks come on screen at once', () => {
    const { t, painted } = textures({ cap: 100, budgetMs: 4, paintMs: 1.1 })
    const many = Array.from({ length: 20 }, (_, i) => i)
    // 1.1 ms a chunk: four fit in 4 ms, the fifth would start after it.
    expect(t.show(many)).toBe(true)
    expect(painted).toHaveLength(4)
    let frames = 2
    while (t.show(many)) frames++
    // Five frames of four.
    expect(painted).toHaveLength(20)
    expect(frames).toBe(5)
    // One that alone takes longer than the budget is still painted: a frame always gets one.
    const slow = textures({ budgetMs: 4, paintMs: 10 })
    expect(slow.t.show([1, 2])).toBe(true)
    expect(slow.painted).toEqual([1])
  })

  it('paints only the home view of a Player who explored the whole map, all of it loaded', () => {
    // The staged Player of T99.1: all 32,400 chunks explored and loaded with the minimap open.
    const size = 5_760
    const loaded = chunksAcross(size) ** 2
    const { t } = textures({ cap: KEPT_TEXTURES })
    const home = visibleChunks(
      { x: 2_880, y: 2_880, scale: 12 },
      { width: 1920, height: 1080 },
      size,
    )
    while (t.show(home));
    expect(loaded).toBe(32_400)
    expect(t.size).toBe(home.length)
    expect(t.size).toBeLessThan(100)
  })
})
