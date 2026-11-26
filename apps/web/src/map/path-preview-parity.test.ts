import { readFileSync } from 'node:fs'
import { CARRIAGE_SPEED, DIAGONAL_STEP, TERRAIN_SPEED } from '@csp/balance'
import { describe, expect, it } from 'vitest'
import { Terrain } from '../world/terrain.js'
import { searchPath, type Goer, type Point } from './path-preview.js'

/**
 * The route preview (`previewPath`) stays in TypeScript (T122.8: it runs as the pointer moves),
 * so it is held to the server's pathfinder here: the fixture `crates/csp-sim/fixtures/paths/
 * requests.json` is 200 ways on a 512 × 512 generated map, with roads and a walled city, that the
 * Rust pathfinder finds exactly (`matches_the_path_fixtures_exactly` in
 * `crates/csp-sim/src/pathfinding/tests.rs`). The preview is asked each of them on the same
 * ground, with the walls as the client blocks them (`wayGround` in `App.tsx`: a wall, and a gate
 * closed or shut to the one going unless it is their side's). Ways along the walls (`onWalls`)
 * and to beside a tile (`near`) are the server's alone; the preview doesn't draw them.
 */

const root = new URL('../../../../crates/csp-sim/fixtures/', import.meta.url)

interface WallTile {
  tile: number
  kind: 'wall' | 'gate'
  realms: string[]
  closed: boolean
  shutTo: string[]
}

interface Request {
  id: number
  from: [number, number]
  to: [number, number]
  costs: 'walking' | 'carriage'
  walls: boolean
  roads: boolean
  options: { realmId?: string; onWalls?: boolean; near?: boolean }
  result: { status: 'found'; path: [number, number][]; cost: number } | { status: string }
}

const fixture = JSON.parse(readFileSync(new URL('paths/requests.json', root), 'utf8')) as {
  terrain: string
  size: number
  roads: number[]
  walls: { tiles: WallTile[] }
  requests: Request[]
}
const size = fixture.size
const tiles = readFileSync(new URL(fixture.terrain, root))
const roads = new Set(fixture.roads)
const walls = new Map(fixture.walls.tiles.map((w) => [w.tile, w]))

/** The ground under (x, y) as the client gives it the preview: a road over any terrain. */
const groundWith = (withRoads: boolean) => (x: number, y: number) => {
  const t = y * size + x
  return withRoads && roads.has(t) ? Terrain.Road : (tiles[t]! as Terrain)
}

/** The tiles the client blocks for someone of `realmId` (`wayGround`). */
const blockedFor = (withWalls: boolean, realmId: string | undefined) => (x: number, y: number) => {
  const w = withWalls ? walls.get(y * size + x) : undefined
  if (!w) return false
  if (w.kind === 'wall') return true
  const own = realmId !== undefined && w.realms.includes(realmId)
  return !own && (w.closed || (realmId !== undefined && w.shutTo.includes(realmId)))
}

/** What a way costs: each step the time onto its tile, a diagonal one `DIAGONAL_STEP` times. */
function costOf(
  from: Point,
  path: readonly Point[],
  goer: Goer,
  ground: (x: number, y: number) => Terrain,
) {
  const speeds: Partial<Record<number, number>> =
    goer === 'carriage' ? CARRIAGE_SPEED : TERRAIN_SPEED
  let [x, y] = from
  let cost = 0
  for (const [nx, ny] of path) {
    const step = 1 / speeds[ground(nx, ny)]!
    cost += nx !== x && ny !== y ? step * DIAGONAL_STEP : step
    ;[x, y] = [nx, ny]
  }
  return cost
}

const asked = fixture.requests.filter((r) => !r.options.onWalls && !r.options.near)

describe('the route preview against the server’s pathfinder (fixture paths/requests.json)', () => {
  // On the fixture: of 113 ways the server finds, the preview finds 78 (17 the very same tiles,
  // 61 another way of the same cost: the two break ties differently) and gives up on 35 past
  // `PREVIEW_SEARCH_TILES`, drawing a straight line; of 50 it can't, it says so of 15 and gives up
  // on the rest.
  it('finds a way as cheap as the server’s wherever its search reaches, and none where there is none', () => {
    let compared = 0
    for (const r of asked) {
      const goer: Goer = r.costs === 'carriage' ? 'carriage' : 'foot'
      const ground = groundWith(r.roads)
      const from = { x: r.from[0], y: r.from[1] }
      const to = { x: r.to[0], y: r.to[1] }
      const found = searchPath(size, from, to, ground, goer, blockedFor(r.walls, r.options.realmId))
      if (r.result.status !== 'found') {
        expect(typeof found, `request ${r.id}: no way there`).toBe('string')
        continue
      }
      expect(found, `request ${r.id}: there is a way`).not.toBe('none')
      if (typeof found === 'string') continue
      compared++
      // The server adds up its costs in 32-bit floats.
      const { cost } = r.result as { cost: number }
      const preview = costOf(r.from, found, goer, ground)
      expect(
        Math.abs(preview - cost) / cost,
        `request ${r.id}: ${preview} vs ${cost}`,
      ).toBeLessThan(1e-5)
      expect(found.at(-1), `request ${r.id}`).toEqual(r.to)
    }
    expect(compared).toBeGreaterThanOrEqual(78)
  })
})
