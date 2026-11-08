// Writes ticks.txt from the frozen TypeScript: the fixture requests all queued at once, worked
// off with `advance(8)` on a clock that moves on 1 per reading. Run from the repo root:
//   corepack pnpm exec tsx --conditions=source crates/csp-sim/src/pathfinding/gen-ticks.mts crates/csp-sim/src/pathfinding/ticks.txt
import { readFileSync, writeFileSync } from 'node:fs'
import type { WallMap, WallTile } from '@csp/shared'
import {
  PathFinder,
  WALKING_COSTS,
  CARRIAGE_COSTS,
  type PathOptions,
  type Point,
} from '../../../../apps/server/src/pathfinding.ts'

/** `fixtures/paths/requests.json`, as `scripts/dump-fixtures.mts` writes it. */
interface Fixture {
  roads: number[]
  walls: { tiles: (WallTile & { tile: number })[]; inside: number[] }
  requests: {
    id: number
    from: Point
    to: Point
    costs: 'walking' | 'carriage'
    walls: boolean
    roads: boolean
    options: PathOptions
  }[]
}

const fx = JSON.parse(
  readFileSync('crates/csp-sim/fixtures/paths/requests.json', 'utf8'),
) as Fixture
const tiles = new Uint8Array(readFileSync('crates/csp-sim/fixtures/terrain/1-512.bin'))
const terrain = { size: 512, tiles }
const walls: WallMap = {
  size: 512,
  tiles: new Map(
    fx.walls.tiles.map((w): [number, WallTile] => {
      const { tile, ...rest } = w
      return [tile, rest]
    }),
  ),
  inside: new Set(fx.walls.inside),
}
const out: string[] = []
for (const local of [512, 64]) {
  for (const key of ['true/true', 'true/false', 'false/true', 'false/false']) {
    const [ww, rr] = key.split('/').map((s) => s === 'true')
    const f = new PathFinder(terrain, local)
    if (ww) f.setWalls(walls)
    if (rr) f.setRoads(fx.roads)
    const reqs = fx.requests.filter((r) => r.walls === ww && r.roads === rr)
    for (const r of reqs)
      f.request(
        String(r.id),
        r.from,
        r.to,
        r.costs === 'walking' ? WALKING_COSTS : CARRIAGE_COSTS,
        r.options,
      )
    let t = 0
    const now = () => t++
    for (let tick = 0; f.pending > 0; tick++) {
      if (tick > 1e6) throw new Error('no end')
      f.advance(8, now)
      for (const r of reqs) {
        const res = f.result(String(r.id))
        if (res && res.status !== 'searching')
          out.push(
            `${local} ${key} ${r.id} ${tick} ${res.status} ${res.status === 'found' ? res.path.length + ' ' + res.cost : ''}`.trim(),
          )
      }
    }
  }
}
writeFileSync(process.argv[2], out.join('\n') + '\n')
