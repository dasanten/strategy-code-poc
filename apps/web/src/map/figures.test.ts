import { describe, expect, it } from 'vitest'
import type { Resident, ResidentOrder } from '@csp/shared'
import { FIGURES_PER_TILE, residentActivity, tileFigures } from './figures.js'
import type { Relationship } from './tokens.js'

const resident = (
  order: ResidentOrder | null,
  carried: Resident['carried'] = {},
): Pick<Resident, 'order' | 'carried' | 'x' | 'y'> => ({ order, carried, x: 3, y: 4 })

describe('residentActivity', () => {
  it('reads fighting from an attack, whatever else they do', () => {
    const attack: ResidentOrder = {
      kind: 'attack',
      targetId: 'r9',
      path: [[4, 4]],
      progress: 0,
      strike: 0,
      started: true,
    }
    expect(residentActivity(resident(attack, { wood: 5 }))).toBe('fighting')
  })

  it('reads working from working a workplace, building, tearing down or laying a road', () => {
    const at = { x: 3, y: 4 }
    expect(
      residentActivity(
        resident({ kind: 'workAt', buildingId: 'b', at, progress: 0 }, { stone: 3 }),
      ),
    ).toBe('working')
    expect(residentActivity(resident({ kind: 'build', building: 'house', at, siteId: 's' }))).toBe(
      'working',
    )
    expect(residentActivity(resident({ kind: 'tearDown', buildingId: 'b', at }))).toBe('working')
    const road = (phase: 'walking' | 'building'): ResidentOrder => ({
      kind: 'roadLine',
      tiles: [[3, 4]],
      phase,
      path: null,
      progress: 0,
      siteId: null,
    })
    expect(residentActivity(resident(road('building')))).toBe('working')
    expect(residentActivity(resident(road('walking')))).toBe('walking')
  })

  it('reads carrying from a load, but not from food and gear', () => {
    const walk: ResidentOrder = { kind: 'walkTo', target: { x: 9, y: 9 }, path: null, progress: 0 }
    expect(residentActivity(resident(walk, { wood: 4, food: 2 }))).toBe('carrying')
    expect(residentActivity(resident(null, { coins: 10 }))).toBe('carrying')
    expect(residentActivity(resident(walk, { food: 6, sword: 1, shield: 1 }))).toBe('walking')
    expect(residentActivity(resident(null, { food: 6, wood: 0 }))).toBeUndefined()
  })

  it('reads walking only while on the way', () => {
    const walkTo = (x: number, y: number): ResidentOrder => ({
      kind: 'walkTo',
      target: { x, y },
      path: null,
      progress: 0,
    })
    expect(residentActivity(resident(walkTo(9, 9)))).toBe('walking')
    // Arrived: the order stays until another comes, but they stand still.
    expect(residentActivity(resident(walkTo(3, 4)))).toBeUndefined()
    expect(
      residentActivity(resident({ kind: 'climb', wallId: 'w', at: { x: 3, y: 4 }, progress: 0 })),
    ).toBe('walking')
    expect(residentActivity(resident({ kind: 'pair', partnerId: 'p', since: 0 }))).toBeUndefined()
    expect(residentActivity(resident(null))).toBeUndefined()
  })
})

describe('tileFigures', () => {
  const rels: Record<string, Relationship | undefined> = {
    me: 'own',
    me2: 'own',
    ally: 'alliance',
    o1: 'other',
    o2: 'other',
    npc: 'npc',
  }
  const relOf = (id: string) => rels[id]

  it('puts up to four residents in their own place, lower corners first', () => {
    const { figures, more } = tileFigures(['o1', 'o2', 'npc', 'ally'], relOf)
    expect(more).toBeUndefined()
    expect(figures).toHaveLength(FIGURES_PER_TILE)
    expect(figures[0]).toMatchObject({ dx: 0.26, dy: 0.74 })
    expect(figures[1]).toMatchObject({ dx: 0.74, dy: 0.74 })
    // Every figure stands inside the tile, each in a place of its own.
    const places = new Set(figures.map((f) => `${f.dx},${f.dy}`))
    expect(places.size).toBe(4)
    for (const f of figures) {
      expect(f.dx).toBeGreaterThan(0)
      expect(f.dx).toBeLessThan(1)
      expect(f.dy).toBeGreaterThan(0)
      expect(f.dy).toBeLessThan(1)
    }
  })

  it('shows three and a "+N" badge in the last place when more stand there', () => {
    const ids = ['o1', 'o2', 'npc', 'ally', 'me', 'me2']
    const { figures, more } = tileFigures(ids, relOf)
    expect(figures).toHaveLength(3)
    expect(figures.map((f) => f.id)).toEqual(['me', 'me2', 'ally'])
    expect(more).toEqual({ ids: ['o1', 'o2', 'npc'], dx: 0.74, dy: 0.26 })
    // Everyone is either drawn or counted, once.
    expect([...figures.map((f) => f.id), ...more!.ids].sort()).toEqual([...ids].sort())
  })

  it('draws your Leader first, then your own, alliance and other residents', () => {
    const { figures } = tileFigures(['o1', 'ally', 'me2', 'npc', 'me'], relOf, 'me')
    expect(figures.map((f) => f.id)).toEqual(['me', 'me2', 'ally'])
    expect(tileFigures(['o2', 'o1'], relOf).figures.map((f) => f.id)).toEqual(['o2', 'o1'])
  })

  it('on the admin map, draws every Leader first and realms in their colour like others', () => {
    const tones: Record<string, number | 'npc'> = { a: 0x111111, b: 0x222222, n: 'npc' }
    const { figures } = tileFigures(['n', 'a', 'b'], (id) => tones[id], new Set(['b']))
    expect(figures.map((f) => f.id)).toEqual(['b', 'a', 'n'])
  })
})
