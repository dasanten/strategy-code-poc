import type { Graphics } from 'pixi.js'
import {
  LINE_BUILDING,
  isLineOrder,
  roadLine,
  type Building,
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

/**
 * What the Player's residents are set to build but haven't laid out yet (`CONTEXT.md`: Planned
 * building), drawn as faint ghosts on the map.
 */
export interface Plans {
  /** Tiles still to build of their road and wall lines, running or queued. */
  lines: GhostTile[]
}

/** How strongly a ghost is drawn: faint, or a picked resident's. */
export const GHOST_ALPHA = { faint: 0.3, strong: 0.65 } as const

/** Who the plans are of, and what already stands. */
interface Planners {
  residents: readonly Pick<SeenResident, 'id' | 'owner' | 'order' | 'queue' | 'interrupted'>[]
  buildings: readonly Pick<Building, 'kind' | 'x' | 'y'>[]
  home: { realmId: string }
  map: { size: number }
}

/**
 * The lines a resident is on or has queued, each with its tiles in order: the running road or
 * wall line (or the one a defence script interrupted, which goes on after it), then those of the
 * queue's steps still waiting, after the current one and, in a looping queue, before it too.
 */
export function plannedLines(
  r: Pick<SeenResident, 'order' | 'queue' | 'interrupted'>,
  size: number,
): { kind: LineBuilding; tiles: readonly (readonly [number, number])[] }[] {
  const out: { kind: LineBuilding; tiles: readonly (readonly [number, number])[] }[] = []
  for (const o of [r.order, r.interrupted?.order]) {
    if (isLineOrder(o)) out.push({ kind: LINE_BUILDING[o.kind], tiles: o.tiles })
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

/** A queue step's line, from its two end tiles (`roadLine` in `@csp/shared`), if it is one. */
function queuedLine(order: OrderRequest, size: number) {
  if (order.kind !== 'roadLine' && order.kind !== 'wallLine') return undefined
  const { from, to } = order
  if (!isTile(from) || !isTile(to)) return undefined
  return { kind: LINE_BUILDING[order.kind], tiles: roadLine(from, to, size) }
}

const isTile = (t: unknown): t is { x: number; y: number } =>
  typeof t === 'object' &&
  t !== null &&
  Number.isInteger((t as { x: unknown }).x) &&
  Number.isInteger((t as { y: unknown }).y)

/**
 * The Player's planned building (`CONTEXT.md`: Planned building): the tiles of their residents'
 * lines that have no site or finished building of the line's kind yet (a wall line passes over a
 * gate too), each once, strong if any picked resident plans it.
 */
export function plannedBuilding(world: Planners, picked: readonly string[]): Plans {
  const { size } = world.map
  const built = new Set<string>()
  for (const b of world.buildings) {
    if (b.kind === 'road') built.add(`road:${b.x},${b.y}`)
    if (b.kind === 'wall' || b.kind === 'gate') built.add(`wall:${b.x},${b.y}`)
  }
  const ghosts = new Map<string, GhostTile>()
  for (const r of world.residents) {
    if (r.owner !== world.home.realmId) continue
    const strong = picked.includes(r.id)
    for (const { kind, tiles } of plannedLines(r, size)) {
      for (const [x, y] of tiles) {
        const key = `${kind}:${x},${y}`
        if (built.has(key)) continue
        const had = ghosts.get(key)
        if (!had) ghosts.set(key, { x, y, kind, strong })
        else if (strong) had.strong = true
      }
    }
  }
  return { lines: [...ghosts.values()] }
}

/**
 * Draws the Player's plans as ghosts under the tokens: road tiles as a faint road band, wall
 * tiles as a faint wall in `wallColour`, each joined to the ghosts and finished ones beside it
 * the way a road or wall is (`roads.ts`), so a ring shows whole and fills in as it is built.
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
