import { describe, expect, it } from 'vitest'
import {
  BUILDABLE,
  Terrain,
  buildMenu,
  type Building,
  type BuildingKind,
  type City,
  type KnownNode,
} from '@csp/shared'
import { buildMenuGroups, canChooseKind, workSpan } from './build-menu-view.js'
import { BUILDING_NAMES } from './map/palette.js'
import { buildHereProblem } from './selection-view.js'

const plains = { size: 200, at: () => Terrain.Plains }
const seen = { buildings: [] as Building[], cities: [] as City[] }
const forestAt = (x: number, y: number) => ({ kind: 'forest', x, y }) as KnownNode

/** The menu on a tile at (50, 50), with the given node there or none. */
const menu = (node?: KnownNode, nodes: Record<string, KnownNode> = {}) =>
  buildMenuGroups(node, (kind) =>
    buildHereProblem(
      kind,
      50,
      50,
      seen,
      (x, y) => (x === 50 && y === 50 ? node : nodes[`${x},${y}`]),
      plains,
    ),
  )

const entry = (groups: ReturnType<typeof menu>, kind: BuildingKind) =>
  groups.flatMap((g) => g.kinds).find((k) => k.kind === kind)!

describe('the Build menu', () => {
  it('shows every buildable kind once, by its name, under the groups of the rule', () => {
    const groups = menu()
    expect(groups.map((g) => g.name)).toEqual([
      'Resources',
      'Food and animals',
      'Industry',
      'City',
      'Defence',
      'Transport',
    ])
    const kinds = groups.flatMap((g) => g.kinds)
    expect(kinds.map((k) => k.kind).sort()).toEqual([...BUILDABLE].sort())
    for (const k of kinds) expect(k.name).toBe(BUILDING_NAMES[k.kind])
  })

  it('dims a kind that can’t go here, with its reason in the kind’s own name', () => {
    const groups = menu(undefined)
    expect(entry(groups, 'house').problem).toBe('a house goes in a city’s area')
    expect(entry(groups, 'carriage').problem).toBe('a carriage is built at a finished stable')
    expect(entry(groups, 'lumberCamp').problem).toBe(
      'a lumber camp goes with one tile on a fitting resource node',
    )
    expect(entry(groups, 'storage').problem).toBeUndefined()
    expect(entry(groups, 'road').problem).toBeUndefined()
  })

  it('on a node leaves its workplace and the road, and dims the others, as the menu did', () => {
    const groups = menu(forestAt(50, 50))
    const open = groups.flatMap((g) => g.kinds).filter((k) => k.problem === undefined)
    expect(open.map((k) => k.kind).sort()).toEqual(['lumberCamp', 'road'])
    expect(entry(groups, 'trainingGround').problem).toBe(
      'a training ground goes off any resource node, and not on Mountain',
    )
    expect(entry(groups, 'quarry').problem).toBe(
      'a quarry goes with one tile on a fitting resource node',
    )
  })

  it('offers a workplace only on its node, even when its footprint would reach one from here', () => {
    // The rule lets a footprint reach the node, but from here the card never offered it.
    const groups = menu(undefined, { '51,51': forestAt(51, 51) })
    expect(entry(groups, 'lumberCamp').problem).toBe(
      'a lumber camp is built standing on its resource node',
    )
  })

  it('built now, a kind must fit the tile as it stands', () => {
    const groups = menu()
    expect(canChooseKind(entry(groups, 'storage'), false)).toBe(true)
    expect(canChooseKind(entry(groups, 'road'), false)).toBe(true)
    expect(canChooseKind(entry(groups, 'house'), false)).toBe(false)
  })

  it('planned ahead, what the tile lacks today can still be added: its turn checks it', () => {
    // A town hall first and the house beside it; a stable first and the carriage at it.
    const groups = menu()
    expect(canChooseKind(entry(groups, 'house'), true)).toBe(true)
    expect(canChooseKind(entry(groups, 'carriage'), true)).toBe(true)
    expect(canChooseKind(entry(groups, 'road'), true)).toBe(true)
  })

  it('planned ahead, what the ground rules out stays out, as the planner’s list did', () => {
    const open = (groups: ReturnType<typeof menu>) =>
      groups
        .flatMap((g) => g.kinds)
        .filter((k) => canChooseKind(k, true))
        .map((k) => k.kind)
    const off = open(menu())
    expect(off).not.toContain('lumberCamp')
    expect(off.filter((k) => k !== 'road' && k !== 'carriage').sort()).toEqual(
      [...buildMenu(undefined)].sort(),
    )
    expect(open(menu(forestAt(50, 50))).sort()).toEqual(['lumberCamp', 'road'])
  })

  it('tells work in game time', () => {
    expect(workSpan(0)).toBe('0 game hours')
  })
})
