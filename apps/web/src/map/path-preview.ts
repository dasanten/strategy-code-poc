import {
  CARRIAGE_SPEED,
  DIAGONAL_STEP,
  TERRAIN_SPEED,
  Terrain,
  roadLine,
  wrap,
  wrapDelta,
} from '@csp/shared'

/** A tile on the map. */
export type Point = readonly [x: number, y: number]

/** Who goes: on foot (walking or riding) or with a carriage, which goes by its own speeds. */
export type Goer = 'foot' | 'carriage'

/**
 * How many tiles the preview's search looks at before it gives up and draws a straight line: a
 * few dozen tiles of detour around a lake, cheap enough to run each time the pointer moves on.
 */
export const PREVIEW_SEARCH_TILES = 20_000

/**
 * The way a resident or carriage would go from `from` to `to` (`CONTEXT.md`: Picking a target),
 * found the way the server finds it, on the ground as the Player knows it: the cheapest path by
 * the time each tile takes to cross (`TERRAIN_SPEED`, `CARRIAGE_SPEED`; a road wherever one is
 * built), a diagonal step `DIAGONAL_STEP` times as long and never cutting a corner. `ground`
 * gives undefined where unexplored, which counts as Plains, so the way runs straight there.
 * `blocked` tiles can't be stepped onto: walls, and gates shut to the one going. When no way is
 * found within `PREVIEW_SEARCH_TILES` tiles, a straight line. The tiles to go, without `from`,
 * as the server's paths are.
 */
export function previewPath(
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ground: (x: number, y: number) => Terrain | undefined,
  goer: Goer = 'foot',
  blocked: (x: number, y: number) => boolean = () => false,
): Point[] {
  const speeds: Partial<Record<number, number>> =
    goer === 'carriage' ? CARRIAGE_SPEED : TERRAIN_SPEED
  const cost = (x: number, y: number) => {
    if (blocked(x, y)) return Infinity
    const speed = speeds[ground(x, y) ?? Terrain.Plains]
    return speed ? 1 / speed : Infinity
  }
  const [gx, gy] = [wrap(to.x, size), wrap(to.y, size)]
  const [sx, sy] = [wrap(from.x, size), wrap(from.y, size)]
  if (sx === gx && sy === gy) return []
  const straight = () => roadLine(from, to, size).slice(1)
  if (cost(gx, gy) === Infinity) return straight()
  // The cheapest a step can cost, for the heuristic: a road's, or else the fastest ground's.
  const cheapest = 1 / Math.max(...Object.values(speeds).filter((s): s is number => !!s))
  const h = (x: number, y: number) => {
    const dx = Math.abs(wrapDelta(x, gx, size))
    const dy = Math.abs(wrapDelta(y, gy, size))
    return (Math.max(dx, dy) + (DIAGONAL_STEP - 1) * Math.min(dx, dy)) * cheapest
  }
  const key = (x: number, y: number) => y * size + x
  const g = new Map<number, number>([[key(sx, sy), 0]])
  const cameFrom = new Map<number, number>()
  const done = new Set<number>()
  const open = new Heap()
  open.push(key(sx, sy), h(sx, sy))
  while (open.size > 0 && done.size < PREVIEW_SEARCH_TILES) {
    const t = open.pop()
    if (done.has(t)) continue
    done.add(t)
    const [x, y] = [t % size, Math.floor(t / size)]
    if (x === gx && y === gy) return pathTo(t, cameFrom, size)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const [nx, ny] = [wrap(x + dx, size), wrap(y + dy, size)]
        let step = cost(nx, ny)
        if (step === Infinity) continue
        if (dx !== 0 && dy !== 0) {
          // Never cutting a corner: both straight tiles beside it can be stepped onto too.
          if (cost(nx, y) === Infinity || cost(x, ny) === Infinity) continue
          step *= DIAGONAL_STEP
        }
        const n = key(nx, ny)
        const ng = g.get(t)! + step
        if (ng >= (g.get(n) ?? Infinity)) continue
        g.set(n, ng)
        cameFrom.set(n, t)
        open.push(n, ng + h(nx, ny))
      }
    }
  }
  return straight()
}

/** The tiles from the start to tile `t`, without the start. */
function pathTo(t: number, cameFrom: ReadonlyMap<number, number>, size: number): Point[] {
  const out: Point[] = []
  for (let at: number | undefined = t; cameFrom.has(at!); at = cameFrom.get(at!)) {
    out.push([at! % size, Math.floor(at! / size)])
  }
  return out.reverse()
}

/** A binary min-heap of tile keys by priority. */
class Heap {
  private keys: number[] = []
  private prios: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, prio: number): void {
    const { keys, prios } = this
    let i = keys.length
    keys.push(key)
    prios.push(prio)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (prios[p]! <= prio) break
      keys[i] = keys[p]!
      prios[i] = prios[p]!
      i = p
    }
    keys[i] = key
    prios[i] = prio
  }

  pop(): number {
    const { keys, prios } = this
    const top = keys[0]!
    const lastKey = keys.pop()!
    const lastPrio = prios.pop()!
    if (keys.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= keys.length) break
        const r = l + 1
        const c = r < keys.length && prios[r]! < prios[l]! ? r : l
        if (prios[c]! >= lastPrio) break
        keys[i] = keys[c]!
        prios[i] = prios[c]!
        i = c
      }
      keys[i] = lastKey
      prios[i] = lastPrio
    }
    return top
  }
}
