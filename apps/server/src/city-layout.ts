import {
  CITY_GRID_BLOCK,
  CITY_LAYOUTS,
  CITY_QUARTER_ROWS,
  CITY_RING_STEP,
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
  /**
   * Whether a building of `kind` may have that tile once no `spot` is left for it, for a layout that
   * lets it go elsewhere rather than stop the city.
   */
  spill?(kind: BuildingKind, x: number, y: number): boolean
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
  switch (city.layout) {
    case undefined:
      return undefined
    case 'grid':
      return gridPlan(world, city, home, gate, size)
    case 'rings':
      return ringsPlan(world, city, home, gate, size)
    case 'mainStreet':
      return mainStreetPlan(world, city, home, gate, size)
    case 'quarters':
      return quartersPlan(world, city, home, gate, size)
  }
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

/** The part of a Quarters city a kind of building belongs in. */
function quarterOf(kind: BuildingKind): 'houses' | 'storages' | 'workshops' {
  if (kind === 'house') return 'houses'
  return kind === 'storage' ? 'storages' : 'workshops'
}

/**
 * Quarters: two streets cross at the middle of the town hall, which never moves, so the parts stay
 * put and grow outward with the city. Houses take everything north of the crossing, workshops the
 * south-west and storages the south-east. Each part stands in long rows, in bands
 * `CITY_QUARTER_ROWS` tiles deep between lanes a tile wide, by whole footprints away from the street
 * running north and south. A lane also runs straight through each gate. A building whose part has no
 * room left spills over into a row of another part, unless a new wall is going up to make room.
 */
function quartersPlan(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): LayoutPlan {
  const anchor = middleOf(townHallOf(world, city) ?? home, size)
  const lanes = gateLanes(world, city, home, gate, size)
  const pitch = CITY_QUARTER_ROWS + 1
  const inRow = (kind: BuildingKind, x: number, y: number) => {
    const side = FOOTPRINT[kind]
    const dx = wrapDelta(anchor.x, x, size)
    const at = mod(wrapDelta(anchor.y, y, size), pitch)
    return (
      dx !== 0 &&
      mod(dx > 0 ? dx - 1 : dx, side) === 0 &&
      at > 0 &&
      (at - 1) % side === 0 &&
      at - 1 + side <= CITY_QUARTER_ROWS
    )
  }
  const partAt = (x: number, y: number) => {
    if (wrapDelta(anchor.y, y, size) < 0) return 'houses'
    return wrapDelta(anchor.x, x, size) < 0 ? 'workshops' : 'storages'
  }
  return {
    street: (x, y) =>
      x === anchor.x ||
      mod(wrapDelta(anchor.y, y, size), pitch) === 0 ||
      lanes.columns.has(x) ||
      lanes.rows.has(y),
    spot: (kind, x, y) => inRow(kind, x, y) && partAt(x, y) === quarterOf(kind),
    spill: inRow,
  }
}

/**
 * How far either way of its line a circle of tiles reaches: half a tile's diagonal. Drawn that wide
 * it has no gaps, its tiles joining side to side all the way round.
 */
const CIRCLE_REACH = Math.SQRT1_2

/**
 * Rings: circular lanes round the middle of the town hall, which never moves, `CITY_RING_STEP` tiles
 * apart, so they stay put as the city grows. A circle of buildings runs halfway between each two
 * lanes, with its footprints' middles on that line. Inside the first lane only a storage goes, as
 * in a new city: a daughter that has just its town hall has no other ground, its area reaching short
 * of the first circle. A way runs straight from each gate to the middle and leaves the far side of
 * the town alone, so the circles close there.
 */
function ringsPlan(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): LayoutPlan {
  const anchor = middleOf(townHallOf(world, city) ?? home, size)
  const ways = gateWays(world, city, home, anchor, gate, size)
  return {
    street: (x, y) => {
      const dx = wrapDelta(anchor.x, x, size)
      const dy = wrapDelta(anchor.y, y, size)
      const far = Math.hypot(dx, dy)
      const lane = Math.round(far / CITY_RING_STEP)
      if (lane > 0 && Math.abs(far - lane * CITY_RING_STEP) <= CIRCLE_REACH) return true
      return ways.some((way) => way(dx, dy))
    },
    spot: (kind, x, y) => {
      const middle = (FOOTPRINT[kind] - 1) / 2
      const far = Math.hypot(
        wrapDelta(anchor.x, x, size) + middle,
        wrapDelta(anchor.y, y, size) + middle,
      )
      const lane = Math.floor(far / CITY_RING_STEP)
      if (lane === 0) return kind === 'storage'
      return Math.abs(far - (lane + 0.5) * CITY_RING_STEP) <= CIRCLE_REACH
    },
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
  const way = gate ?? gateOffsets(world, city, home, gate, size)[0]!
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
 * The ways from the city's gates, and from where its next gate goes, to the middle, each saying
 * whether a tile (relative to the middle) is on it: straight in along the gate's line until level
 * with the middle, then along to it. The line goes on out past the gate too, where the next gate
 * comes in line with it as the city grows.
 */
function gateWays(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  anchor: { x: number; y: number },
  gate: { dx: number; dy: number } | undefined,
  size: number,
): ((dx: number, dy: number) => boolean)[] {
  const homeDx = wrapDelta(anchor.x, home.x, size)
  const homeDy = wrapDelta(anchor.y, home.y, size)
  // `across` the gate's line and `along` it, from the middle; `out` is the way along it out of town.
  const way =
    (gateAcross: number, gateAlong: number, out: number) => (across: number, along: number) =>
      (across === gateAcross && along * out >= Math.min(0, gateAlong * out)) ||
      (along === 0 && across >= Math.min(0, gateAcross) && across <= Math.max(0, gateAcross))
  return gateOffsets(world, city, home, gate, size).map(({ dx, dy }) => {
    if (Math.abs(dy) >= Math.abs(dx)) return way(homeDx + dx, homeDy + dy, Math.sign(dy))
    const onWay = way(homeDy + dy, homeDx + dx, Math.sign(dx))
    return (x, y) => onWay(y, x)
  })
}

/**
 * The lines of tiles straight through the city's gates, and through where its next gate goes: a
 * column for a gate north or south of the home, else a row. The way out of a gate lies along these.
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
  for (const { dx, dy } of gateOffsets(world, city, home, gate, size)) {
    if (Math.abs(dy) >= Math.abs(dx)) columns.add(wrap(home.x + dx, size))
    else rows.add(wrap(home.y + dy, size))
  }
  return { columns, rows }
}

/**
 * Where the city's gates stand relative to its home, and where its next one goes (south of the home
 * when it has no plan for one yet).
 */
function gateOffsets(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  home: Building,
  gate: { dx: number; dy: number } | undefined,
  size: number,
): { dx: number; dy: number }[] {
  const gates = world.buildings
    .filter((b) => b.kind === 'gate' && b.cityId === city.id)
    .map((b) => ({ dx: wrapDelta(home.x, b.x, size), dy: wrapDelta(home.y, b.y, size) }))
  return [...gates, { dx: gate?.dx ?? 0, dy: gate?.dy ?? 1 }]
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
