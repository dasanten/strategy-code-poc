import { FOOTPRINT, covers } from './shared/footprint.js'
import { NODE_WORKPLACE } from './shared/world.js'
import { ROAD_LINE_MAX_TILES } from '@csp/balance'
import { UNEXPLORED, type Terrain } from './shared/terrain.js'
import { aboutTime } from './shared/estimates.js'
import { roadLine } from './shared/building.js'
import type { BuildingKind, KnownNode, ScriptParamType } from '@csp/shared-types'
import { BUILDING_NAMES, TERRAIN_NAMES } from './map/palette.js'
import { previewPath, type Goer, type Point } from './map/path-preview.js'
import { nextPick, planPickAt, type Plan, type PlanPick, type PlanWorld } from './plan-step.js'
import { paramPickAt } from './script-params-view.js'
import type { PickTarget } from './pick-mode.js'

/** A tile on the map. */
export interface Tile {
  x: number
  y: number
}

/**
 * What a pick previews under the pointer (`CONTEXT.md`: Picking a target): the way there of a
 * walk, drive or ride; a road or wall line; where to build; the building or carriage a Store,
 * Fetch, Work or param would use; or just the tile.
 */
export type PreviewPick =
  | { kind: 'way'; goer: Goer }
  | { kind: 'lineStart'; building: 'road' | 'wall' }
  | { kind: 'line'; building: 'road' | 'wall'; from: Tile }
  | { kind: 'build' }
  | { kind: 'place'; pick: PlanPick }
  | { kind: 'param'; type: ScriptParamType }
  | { kind: 'tile' }

/** What each of the picked resident's picks previews; a line's end needs where it starts. */
const RESIDENT_PREVIEWS = {
  walk: { kind: 'way', goer: 'foot' },
  drive: { kind: 'way', goer: 'carriage' },
  driveOff: { kind: 'way', goer: 'carriage' },
  hitchOff: { kind: 'way', goer: 'carriage' },
  haul: { kind: 'way', goer: 'carriage' },
  roadFrom: { kind: 'lineStart', building: 'road' },
  wallFrom: { kind: 'lineStart', building: 'wall' },
} as const

/** What each of the group's picks previews that is no line. */
const GROUP_PREVIEWS: Partial<Record<string, PreviewPick>> = {
  ...RESIDENT_PREVIEWS,
  work: { kind: 'place', pick: 'workplace' },
  build: { kind: 'build' },
  tearDown: { kind: 'place', pick: 'building' },
  storeAt: { kind: 'place', pick: 'storage' },
  fetchFrom: { kind: 'place', pick: 'storage' },
}

/**
 * What the pick the map waits for previews (`PreviewPick`): `lineFrom` is where a line picked
 * so far starts, `plan` the step planned with Add step.
 */
export function previewPickOf(
  target: PickTarget,
  { lineFrom, plan }: { lineFrom?: Tile; plan?: Plan },
): PreviewPick {
  const line = (mode: string): PreviewPick | undefined => {
    if (mode !== 'roadTo' && mode !== 'wallTo') return undefined
    const building = mode === 'roadTo' ? 'road' : 'wall'
    return lineFrom ? { kind: 'line', building, from: lineFrom } : { kind: 'lineStart', building }
  }
  if (target.kind === 'resident') {
    const mode = target.mode
    return line(mode) ?? (RESIDENT_PREVIEWS as Partial<Record<string, PreviewPick>>)[mode]!
  }
  if (target.kind === 'group') return line(target.mode) ?? GROUP_PREVIEWS[target.mode] ?? TILE
  if (target.kind === 'param') return { kind: 'param', type: target.param.type }
  const pick = plan && nextPick(plan)?.pick
  if (target.kind !== 'plan' || !plan || !pick) return TILE
  if (pick !== 'tile') return pick === 'spot' ? TILE : { kind: 'place', pick }
  if (plan.kind === 'walk') return { kind: 'way', goer: 'foot' }
  if (plan.kind === 'drive' || plan.kind === 'haul') return { kind: 'way', goer: 'carriage' }
  if (plan.kind === 'build') return { kind: 'build' }
  if (plan.kind === 'road' || plan.kind === 'wall') {
    const start = plan.picked[0]
    return start
      ? { kind: 'line', building: plan.kind, from: start }
      : { kind: 'lineStart', building: plan.kind }
  }
  return TILE
}

const TILE: PreviewPick = { kind: 'tile' }

/** What the preview needs of what the Player knows. */
export interface PreviewWorld extends PlanWorld {
  /** The cities the Player knows by name, to name a building of one. */
  cityNames: readonly { id: string; name: string }[]
  /** What is underfoot as the Player knows it: a road where one is built, undefined unexplored. */
  ground: (x: number, y: number) => Terrain | undefined
  /** Whether a way may not step onto a tile: a wall, or a gate shut to the realm. */
  blocked?: (x: number, y: number) => boolean
  /** The known resource node on a tile. */
  nodeAt: (x: number, y: number) => KnownNode | undefined
  /** Why a building of `kind` can't be laid out from (x, y) (`buildHereProblem`). */
  buildProblem: (kind: BuildingKind, x: number, y: number) => string | undefined
}

/** One who would go there: where from, and about how many ticks a way takes them. */
export interface Goes {
  from: Tile
  /** About how many ticks the way takes them (`arrivalTicks`), if that can be told. */
  ticks?: (path: readonly Point[], goer: Goer) => number | undefined
}

/** How many of a group's ways the preview draws, from the first of them. */
export const PREVIEW_WAYS = 6

/** What the map draws for a pick under the pointer, and the banner's line about it. */
export interface PickPreview {
  at: Tile
  /** The way each would go there, from their tile. */
  ways: { from: Tile; path: Point[] }[]
  /** The tiles of a road or wall line, and whether it is longer than a line may be. */
  line?: { building: 'road' | 'wall'; tiles: Point[]; tooLong: boolean }
  /** A building's footprint from its north-west tile, and why it doesn't fit, if it doesn't. */
  footprint?: { kind: BuildingKind; x: number; y: number; problem?: string }
  /** The building or carriage the pick would use: its north-west tile and side in tiles. */
  place?: { x: number; y: number; side: number }
  /** What is under the pointer and what the pick would do there, for the banner. */
  label: string
}

/**
 * The preview of a pick at a tile (`CONTEXT.md`: Picking a target): the way of a walk, drive or
 * ride with the arrival estimate, a line with its tile count, a footprint marked where it
 * doesn't fit, or the building a Store, Fetch or Work would use; the label names what is there.
 */
export function pickPreview(
  pick: PreviewPick,
  at: Tile,
  w: PreviewWorld,
  goers: readonly Goes[],
): PickPreview {
  const here = whatIsAt(at, w)
  const base = { at, ways: [], label: here }
  switch (pick.kind) {
    case 'way': {
      const ways = goers.slice(0, PREVIEW_WAYS).map((g) => ({
        from: g.from,
        path: previewPath(w.size, g.from, at, w.ground, pick.goer, w.blocked),
      }))
      const first = ways[0]
      if (!first) return base
      const ticks = goers[0]!.ticks?.(first.path, pick.goer)
      const tiles = `${first.path.length} ${first.path.length === 1 ? 'tile' : 'tiles'}`
      const time = ticks === undefined ? '' : ` · ${aboutTime(ticks)}`
      return { ...base, ways, label: `${here}, ${tiles}${time}` }
    }
    case 'lineStart':
      return { ...base, label: `${here} · the ${pick.building} starts here` }
    case 'line': {
      const tiles = roadLine(pick.from, at, w.size)
      const tooLong = tiles.length > ROAD_LINE_MAX_TILES
      const count = `${pick.building} line of ${tiles.length} ${tiles.length === 1 ? 'tile' : 'tiles'}`
      const label = tooLong
        ? `Too long: a ${count}, at most ${ROAD_LINE_MAX_TILES}`
        : `${here} · a ${count}`
      return { ...base, line: { building: pick.building, tiles, tooLong }, label }
    }
    case 'build': {
      const site = buildingAt(at, w)
      if (site?.site) {
        const place = { x: site.x, y: site.y, side: FOOTPRINT[site.kind] }
        return { ...base, place, label: `${here} · they join it` }
      }
      const node = w.nodeAt(at.x, at.y)
      if (!node || site) return base
      const kind = NODE_WORKPLACE[node.kind]
      const problem = w.buildProblem(kind, at.x, at.y)
      const name = BUILDING_NAMES[kind]
      return {
        ...base,
        footprint: { kind, ...at, ...(problem ? { problem } : {}) },
        label: problem ? `No room for a ${name.toLowerCase()}: ${problem}` : `${name} here`,
      }
    }
    case 'place':
    case 'param': {
      const got =
        pick.kind === 'place' ? planPickAt(w, pick.pick, at) : paramPickAt(w, pick.type, at)
      if (typeof got === 'string') return { ...base, label: `${here} · ${got}` }
      const b = [...w.buildings, ...w.lastSeen].find((x) => x.id === got.id)
      const place = b ? { x: b.x, y: b.y, side: FOOTPRINT[b.kind] } : { ...at, side: 1 }
      return { ...base, place }
    }
    case 'tile':
      return base
  }
}

/** The building on a tile, in sight or as last seen, roads aside. */
function buildingAt(at: Tile, w: PreviewWorld) {
  const on = (list: PreviewWorld['buildings']) =>
    list.find((b) => b.kind !== 'road' && covers(b, at.x, at.y, w.size))
  return on(w.buildings) ?? on(w.lastSeen)
}

/**
 * What is on a tile in words: a building by its city ("Ashford storage", "Farm site"), a
 * carriage, or the ground ("plains", "unexplored ground").
 */
export function whatIsAt(at: Tile, w: PreviewWorld): string {
  const b = buildingAt(at, w)
  if (b) {
    const name = BUILDING_NAMES[b.kind]
    if (b.site) return `${name} site`
    const city = w.cityNames.find((c) => c.id === b.cityId)
    return city ? `${city.name} ${name.toLowerCase()}` : name
  }
  if (w.carriages.some((k) => k.x === at.x && k.y === at.y)) return 'Carriage'
  const ground = w.ground(at.x, at.y)
  if (ground === undefined || (ground as number) === UNEXPLORED) return 'Unexplored ground'
  return TERRAIN_NAMES[ground] ?? 'Ground'
}
