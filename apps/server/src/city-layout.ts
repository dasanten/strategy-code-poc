import {
  CITY_GRID_BLOCK,
  CITY_LAYOUTS,
  CITY_SIDE_LANE_GAP,
  FOOTPRINT,
  middleOf,
  townHallOf,
  wrap,
  wrapDelta,
  type Building,
  type BuildingKind,
  type City,
  type CityLayout,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { hash } from './residents.js'

/*
 * How an NPC city sets out its town (`CONTEXT.md`: City layout): the layout it gets when it comes to
 * be, and what that says about a tile. Where the next building goes among those is `houseTile`'s.
 */

/**
 * The layout a city gets, drawn from the world's seed and its id, so a world always picks the same
 * one for it.
 */
export function pickLayout(seed: number, cityId: string): CityLayout {
  return CITY_LAYOUTS[hash(`${seed}:layout:${cityId}`) % CITY_LAYOUTS.length]!
}

/** What a city's layout says about the ground. */
export interface LayoutPlan {
  /** Whether the tile is kept free for a street. */
  street(x: number, y: number): boolean
  /** Whether a building of `kind` may have the north-west tile of its footprint here. */
  spot(kind: BuildingKind, x: number, y: number): boolean
  /** Which spots it fills first, lowest first; among equals, nearest home. All alike without it. */
  rank?(kind: BuildingKind, x: number, y: number): number
}

/**
 * What the city's layout says about the ground, or undefined for a city without one. `gate` is where
 * its next gate goes, relative to its home, if it has a plan for one.
 */
export function layoutPlan(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): LayoutPlan | undefined {
  if (!city.layout) return undefined
  if (city.layout === 'mainStreet') return mainStreetPlan(world, city, home, gate, size)
  return gridPlan(world, city, home, gate, size)
}

/** `n` counted up from 0 again every `by`, for negative numbers too. */
const mod = (n: number, by: number) => ((n % by) + by) % by

/**
 * Grid: square blocks `CITY_GRID_BLOCK` tiles along each side between lanes a tile wide. The lanes
 * run through the middle of the town hall, which never moves, so they stay put as the city grows,
 * and also straight through each gate, so no building stands in the way out of one. A building takes
 * its place in a block by whole footprints from the block's north-west corner.
 */
function gridPlan(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): LayoutPlan {
  const anchor = middleOf(townHallOf(world, city) ?? home, size)
  const lanes = gateLanes(world, city, home, gate, size)
  const pitch = CITY_GRID_BLOCK + 1
  const inBlock = (from: number, to: number, side: number) => {
    const at = mod(wrapDelta(from, to, size), pitch)
    return at > 0 && (at - 1) % side === 0 && at - 1 + side <= CITY_GRID_BLOCK
  }
  return {
    street: (x, y) =>
      mod(wrapDelta(anchor.x, x, size), pitch) === 0 ||
      mod(wrapDelta(anchor.y, y, size), pitch) === 0 ||
      lanes.columns.has(x) ||
      lanes.rows.has(y),
    spot: (kind, x, y) =>
      inBlock(anchor.x, x, FOOTPRINT[kind]) && inBlock(anchor.y, y, FOOTPRINT[kind]),
  }
}

/**
 * Main street: one straight street from the gate on past the town hall and the far side of the home,
 * with side lanes crossing it every `CITY_SIDE_LANE_GAP` tiles, counted from the middle of the town
 * hall, which never moves. The street runs through where the next gate goes, in line with the one
 * that stands, so it stays put as the city grows.
 *
 * Buildings stand in rows along it, the row on the street filling first (`rank`). Only then do they
 * go further back, along the side lanes, so a building always has a street beside it: a row further
 * back keeps to the tiles next to a lane. A building takes its place by whole footprints counted
 * from the street, and along the street from the side lane before it. Lanes through other gates are
 * kept free too.
 */
function mainStreetPlan(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): LayoutPlan {
  const anchor = middleOf(townHallOf(world, city) ?? home, size)
  const lanes = gateLanes(world, city, home, gate, size)
  const standing = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)
  const way = gate ??
    (standing && {
      dx: wrapDelta(home.x, standing.x, size),
      dy: wrapDelta(home.y, standing.y, size),
    }) ?? { dx: 0, dy: 1 }
  const northSouth = Math.abs(way.dy) >= Math.abs(way.dx)
  const line = northSouth ? wrap(home.x + way.dx, size) : wrap(home.y + way.dy, size)
  /** How far a tile lies to the side of the street, and along it from the town hall. */
  const across = (x: number, y: number) => wrapDelta(line, northSouth ? x : y, size)
  const along = (x: number, y: number) =>
    northSouth ? wrapDelta(anchor.y, y, size) : wrapDelta(anchor.x, x, size)
  const pitch = CITY_SIDE_LANE_GAP + 1
  /** Tiles between the street and a footprint; negative for one that stands on the street. */
  const back = (kind: BuildingKind, x: number, y: number) => {
    const at = across(x, y)
    return at > 0 ? at - 1 : -(at + FOOTPRINT[kind])
  }
  return {
    street: (x, y) =>
      across(x, y) === 0 ||
      mod(along(x, y), pitch) === 0 ||
      lanes.columns.has(x) ||
      lanes.rows.has(y),
    spot: (kind, x, y) => {
      const side = FOOTPRINT[kind]
      const behind = back(kind, x, y)
      const from = mod(along(x, y), pitch) - 1
      if (behind < 0 || behind % side !== 0 || from < 0) return false
      if (from + side > CITY_SIDE_LANE_GAP) return false
      return behind === 0 ? from % side === 0 : from === 0 || from + side === CITY_SIDE_LANE_GAP
    },
    rank: back,
  }
}

/**
 * The lines of tiles straight through the city's gates, and through where its next gate goes (south
 * of the home when it has no plan for one yet): a column for a gate north or south of the home, else
 * a row. The way out of a gate lies along these.
 */
function gateLanes(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): { columns: Set<number>; rows: Set<number> } {
  const columns = new Set<number>()
  const rows = new Set<number>()
  const add = (dx: number, dy: number) => {
    if (Math.abs(dy) >= Math.abs(dx)) columns.add(wrap(home.x + dx, size))
    else rows.add(wrap(home.y + dy, size))
  }
  for (const b of world.buildings) {
    if (b.kind !== 'gate' || b.cityId !== city.id) continue
    add(wrapDelta(home.x, b.x, size), wrapDelta(home.y, b.y, size))
  }
  add(gate?.dx ?? 0, gate?.dy ?? 1)
  return { columns, rows }
}

/**
 * Layouts belong to NPC cities (`CONTEXT.md`: City layout; ADR 0004): every one has a known layout,
 * and a trading post, the HQ or a Player's city has none.
 */
export const cityLayoutsSound: Invariant = {
  name: 'city-layouts-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const report = (city: City, what: string) =>
      out.push({ invariant: this.name, message: `${city.id} ${what}`, entityIds: [city.id] })
    for (const city of world.cities) {
      const npc = city.realmId === null && !city.tradeOrg
      if (npc && !city.layout) report(city, 'is an NPC city with no layout')
      if (!npc && city.layout) report(city, `is no NPC city but has the layout ${city.layout}`)
      if (city.layout && !CITY_LAYOUTS.includes(city.layout)) {
        report(city, `has the unknown layout ${String(city.layout)}`)
      }
    }
    return out
  },
}
