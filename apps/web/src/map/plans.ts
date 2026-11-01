import type { Graphics } from 'pixi.js'
import {
  FOOTPRINT,
  LINE_BUILDING,
  isLineOrder,
  roadLine,
  type Building,
  type BuildingKind,
  type OrderRequest,
  type SeenResident,
} from '@csp/shared'
import { tileToScreen, type Camera, type Size } from './camera.js'
import { ROAD_COLOR } from './palette.js'
import { roadJoins, roadWidth, wallWidths } from './roads.js'

/** What a road or wall line builds on each of its tiles. */
export type LineBuilding = 'road' | 'wall'

/** A tile still to build of one of the Player's lines; `strong` when a picked resident's. */
export interface GhostTile {
  x: number
  y: number
  kind: LineBuilding
  strong: boolean
}

/** A build of the Player's not laid out yet: its kind and north-west tile; `strong` as above. */
export interface GhostFootprint {
  x: number
  y: number
  kind: BuildingKind
  strong: boolean
}

/**
 * What the Player's residents are set to build but haven't laid out yet (`CONTEXT.md`: Planned
 * building), drawn as faint ghosts on the map.
 */
export interface Plans {
  /** Tiles still to build of their road and wall lines, running or queued. */
  lines: GhostTile[]
  /** Footprints of the other builds they are ordered or queued to do. */
  footprints: GhostFootprint[]
}

/** How strongly a ghost is drawn: faint, or a picked resident's. */
export const GHOST_ALPHA = { faint: 0.3, strong: 0.65 } as const

/** Who the plans are of, and what already stands. */
interface Planners {
  residents: readonly Pick<
    SeenResident,
    'id' | 'owner' | 'order' | 'queue' | 'interrupted' | 'script'
  >[]
  buildings: readonly Pick<Building, 'kind' | 'x' | 'y'>[]
  home: { realmId: string }
  map: { size: number }
}

/**
 * The lines a resident is on or has queued, each with its tiles in order: the running road or
 * wall line and Build line task (or the ones a defence script interrupted, which go on after it),
 * then those of the queue's steps still waiting, after the current one and, in a looping queue,
 * before it too.
 */
export function plannedLines(
  r: Pick<SeenResident, 'order' | 'queue' | 'interrupted' | 'script'>,
  size: number,
): { kind: LineBuilding; tiles: readonly (readonly [number, number])[] }[] {
  const out: { kind: LineBuilding; tiles: readonly (readonly [number, number])[] }[] = []
  for (const o of [r.order, r.interrupted?.order]) {
    if (isLineOrder(o)) out.push({ kind: LINE_BUILDING[o.kind], tiles: o.tiles })
  }
  for (const s of [r.script, r.interrupted?.script]) {
    if (s?.line) out.push({ kind: s.line.building, tiles: roadLine(s.line.from, s.line.to, size) })
  }
  const q = r.queue
  if (q) {
    const waiting = [
      ...q.steps.slice(q.current + 1),
      ...(q.loop ? q.steps.slice(0, q.current) : []),
    ]
    for (const { order } of waiting) {
      const line = queuedLine(order, size)
      if (line) out.push(line)
    }
  }
  return out
}

/**
 * A queue step's line, from its two end tiles (`roadLine` in `@csp/shared`), if it is one: a road
 * or wall line order, or a Build line task of road or wall.
 */
function queuedLine(order: OrderRequest, size: number) {
  const kind =
    order.kind === 'roadLine' || order.kind === 'wallLine'
      ? LINE_BUILDING[order.kind]
      : order.kind === 'task' && order.task === 'buildLine' && isLineKind(order.building)
        ? order.building
        : undefined
  const { from, to } = order
  if (!kind || !isTile(from) || !isTile(to)) return undefined
  return { kind, tiles: roadLine(from, to, size) }
}

const isLineKind = (k: unknown): k is LineBuilding => k === 'road' || k === 'wall'

/**
 * The builds a resident is ordered or queued to do, each with the north-west tile of its
 * footprint: a Build order that has no site yet (or the one a defence script interrupted), and
 * the queue's Build steps, the current one too, since its task walks there first and its order
 * shows no place until the site is laid out.
 */
export function plannedBuilds(
  r: Pick<SeenResident, 'order' | 'queue' | 'interrupted'>,
): { kind: BuildingKind; x: number; y: number }[] {
  const out: { kind: BuildingKind; x: number; y: number }[] = []
  for (const o of [r.order, r.interrupted?.order]) {
    if (o?.kind === 'build' && o.siteId === null) out.push({ kind: o.building, ...o.at })
  }
  const q = r.queue
  if (q) {
    const waiting = [...q.steps.slice(q.current), ...(q.loop ? q.steps.slice(0, q.current) : [])]
    for (const { order } of waiting) {
      const build = queuedBuild(order)
      if (build) out.push(build)
    }
  }
  return out
}

/** A queue step's build, a Build task's or order's, if it names its kind and place. */
function queuedBuild(order: OrderRequest) {
  const isBuild = order.kind === 'build' || (order.kind === 'task' && order.task === 'build')
  const { building, at } = order
  if (!isBuild || !isKind(building) || !isTile(at)) return undefined
  return { kind: building, x: at.x, y: at.y }
}

const isKind = (k: unknown): k is BuildingKind =>
  typeof k === 'string' && Object.hasOwn(FOOTPRINT, k)

const isTile = (t: unknown): t is { x: number; y: number } =>
  typeof t === 'object' &&
  t !== null &&
  Number.isInteger((t as { x: unknown }).x) &&
  Number.isInteger((t as { y: unknown }).y)

/**
 * The Player's planned building (`CONTEXT.md`: Planned building): the tiles of their residents'
 * lines that have no site or finished building of the line's kind yet (a wall line passes over a
 * gate too), and the footprints of their builds with no site or finished building of that kind
 * there yet, each once, strong if any picked resident plans it. A single road or wall build is
 * a tile of a line, so it joins the ones beside it.
 */
export function plannedBuilding(world: Planners, picked: readonly string[]): Plans {
  const { size } = world.map
  const built = new Set<string>()
  for (const b of world.buildings) {
    built.add(`${b.kind}:${b.x},${b.y}`)
    if (b.kind === 'gate') built.add(`wall:${b.x},${b.y}`)
  }
  const lines = new Map<string, GhostTile>()
  const footprints = new Map<string, GhostFootprint>()
  const add = <G extends GhostTile | GhostFootprint>(to: Map<string, G>, ghost: G) => {
    const key = `${ghost.kind}:${ghost.x},${ghost.y}`
    if (built.has(key)) return
    const had = to.get(key)
    if (!had) to.set(key, ghost)
    else if (ghost.strong) had.strong = true
  }
  for (const r of world.residents) {
    if (r.owner !== world.home.realmId) continue
    const strong = picked.includes(r.id)
    for (const { kind, tiles } of plannedLines(r, size)) {
      for (const [x, y] of tiles) add(lines, { x, y, kind, strong })
    }
    for (const { kind, x, y } of plannedBuilds(r)) {
      if (kind === 'road' || kind === 'wall') add(lines, { x, y, kind, strong })
      else add(footprints, { x, y, kind, strong })
    }
  }
  return { lines: [...lines.values()], footprints: [...footprints.values()] }
}

/**
 * Draws the Player's plans as ghosts under the tokens: road tiles as a faint road band, wall
 * tiles as a faint wall in `wallColour`, each joined to the ghosts and finished ones beside it
 * the way a road or wall is (`roads.ts`), so a ring shows whole and fills in as it is built; and
 * each planned footprint as a faint square in `wallColour`, the Player's own, the way a
 * building's plate is drawn.
 */
export function drawPlans(
  g: Graphics,
  cam: Camera,
  view: Size,
  size: number,
  plans: Plans,
  buildings: readonly Pick<Building, 'kind' | 'x' | 'y'>[],
  wallColour: number,
) {
  const tile = cam.scale
  for (const strength of ['faint', 'strong'] as const) {
    const alpha = GHOST_ALPHA[strength]
    const inset = tile * 0.08
    const squares: number[][] = []
    for (const f of plans.footprints) {
      if (f.strong !== (strength === 'strong')) continue
      const side = FOOTPRINT[f.kind] * tile
      const [sx, sy] = tileToScreen(cam, view, size, f.x, f.y)
      if (sx + side < 0 || sy + side < 0 || sx > view.width || sy > view.height) continue
      squares.push([sx + inset, sy + inset, side - 2 * inset, side - 2 * inset])
    }
    if (squares.length === 0) continue
    for (const [x, y, w, h] of squares) g.rect(x!, y!, w!, h!)
    g.fill({ color: wallColour, alpha: alpha * 0.35 })
    for (const [x, y, w, h] of squares) g.rect(x!, y!, w!, h!)
    g.stroke({ width: Math.max(1.5, tile * 0.06), color: wallColour, alpha })
  }
  const at = (x: number, y: number) => `${(x + size) % size},${(y + size) % size}`
  const centre = (x: number, y: number) => tileToScreen(cam, view, size, x + 0.5, y + 0.5)
  const near = ([sx, sy]: readonly number[]) =>
    sx! > -tile * 2 &&
    sy! > -tile * 2 &&
    sx! < view.width + tile * 2 &&
    sy! < view.height + tile * 2
  for (const kind of ['road', 'wall'] as const) {
    const ghosts = new Map(
      plans.lines.filter((t) => t.kind === kind).map((t) => [at(t.x, t.y), t] as const),
    )
    if (ghosts.size === 0) continue
    const stands = new Set(
      buildings
        .filter((b) =>
          kind === 'road' ? b.kind === 'road' : b.kind === 'wall' || b.kind === 'gate',
        )
        .map((b) => at(b.x, b.y)),
    )
    const isAny = (x: number, y: number) => ghosts.has(at(x, y)) || stands.has(at(x, y))
    // Each join once, from the tile left of or above it (`roadJoins`), so a finished tile next to
    // a ghost is looked at too; a join is drawn when either end is a ghost, as strong as it.
    const from = new Map<string, readonly [number, number]>()
    for (const t of ghosts.values())
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (isAny(t.x + dx, t.y + dy)) from.set(at(t.x + dx, t.y + dy), [t.x + dx, t.y + dy])
    const joins = new Map<string, Map<string, readonly [number, number]>>()
    const joined = new Set<string>()
    for (const [x, y] of from.values()) {
      const steps =
        kind === 'road'
          ? roadJoins(x, y, isAny)
          : STRAIGHT.filter(([dx, dy]) => isAny(x + dx, y + dy))
      for (const [dx, dy] of steps) {
        const ends = [ghosts.get(at(x, y)), ghosts.get(at(x + dx, y + dy))]
        if (!ends[0] && !ends[1]) continue
        const key = `${ends.some((e) => e?.strong) ? 'strong' : 'faint'},${dx},${dy}`
        const starts = joins.get(key) ?? new Map<string, readonly [number, number]>()
        joins.set(key, starts.set(at(x, y), [x, y]))
        joined.add(at(x, y)).add(at(x + dx, y + dy))
      }
    }
    // Joins one after another the same way are drawn as one line: drawn one by one, they would
    // overlap at every tile and show darker there, the ghosts being see-through.
    const runs = { faint: [] as number[][], strong: [] as number[][] }
    for (const [key, starts] of joins) {
      const [strength, dx, dy] = key.split(',') as ['faint' | 'strong', string, string]
      const [ddx, ddy] = [Number(dx), Number(dy)]
      for (const [x, y] of starts.values()) {
        if (starts.has(at(x - ddx, y - ddy))) continue
        let n = 1
        while (starts.has(at(x + n * ddx, y + n * ddy))) n++
        const [sx, sy] = centre(x, y)
        runs[strength].push([sx, sy, sx + n * ddx * tile, sy + n * ddy * tile])
      }
    }
    // A dot only where a ghost has no join, so one standing alone shows.
    const dots = { faint: [] as number[][], strong: [] as number[][] }
    for (const t of ghosts.values()) {
      const c = centre(t.x, t.y)
      if (!joined.has(at(t.x, t.y)) && near(c)) dots[t.strong ? 'strong' : 'faint'].push([...c])
    }
    const road = roadWidth(tile)
    const wall = wallWidths(tile)
    for (const strength of ['faint', 'strong'] as const) {
      const alpha = GHOST_ALPHA[strength]
      if (kind === 'road') {
        stroke(g, dots[strength], runs[strength], road, ROAD_COLOR, alpha, 'round')
      } else {
        stroke(g, dots[strength], runs[strength], wall.edge, 0x0e1419, alpha * 0.6, 'square')
        stroke(g, dots[strength], runs[strength], wall.band, wallColour, alpha, 'square')
      }
    }
  }
}

/** Right and below: every pair of walls side by side is looked at once. */
const STRAIGHT = [
  [1, 0],
  [0, 1],
] as const

/**
 * Dots and lines in one width and colour; a road's dot is round, a wall's square. A fill or stroke
 * with nothing drawn since the last one would paint the last one's shapes again (Pixi), so each
 * only runs when it has shapes of its own.
 */
function stroke(
  g: Graphics,
  dots: readonly number[][],
  lines: readonly number[][],
  width: number,
  color: number,
  alpha: number,
  cap: 'round' | 'square',
) {
  for (const [x, y] of dots) {
    if (cap === 'round') g.circle(x!, y!, width / 2)
    else g.rect(x! - width / 2, y! - width / 2, width, width)
  }
  if (dots.length > 0) g.fill({ color, alpha })
  for (const [x0, y0, x1, y1] of lines) g.moveTo(x0!, y0!).lineTo(x1!, y1!)
  if (lines.length > 0) g.stroke({ width, color, alpha, cap })
}
