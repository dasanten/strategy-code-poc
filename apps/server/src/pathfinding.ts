import { TERRAIN_SPEED, Terrain, isInsideDisc, type TerrainMap } from '@csp/shared'

/** What crossing one tile of each terrain costs, in plains-tiles; Infinity can't be entered. */
export type TerrainCosts = Readonly<Record<number, number>>

/** Costs for someone on foot: the inverse of each terrain's speed. Lake and Sea are impassable. */
export const WALKING_COSTS: TerrainCosts = costsFrom(TERRAIN_SPEED)

/** Costs for a carriage: as on foot, but it cannot enter mountains (`CONTEXT.md`: Carriage). */
export const CARRIAGE_COSTS: TerrainCosts = { ...WALKING_COSTS, [Terrain.Mountain]: Infinity }

function costsFrom(speeds: Partial<Record<number, number>>): TerrainCosts {
  const costs: Record<number, number> = {}
  for (let t = 0; t < 256; t++) {
    const speed = speeds[t]
    costs[t] = speed ? 1 / speed : Infinity
  }
  return costs
}

export type Point = readonly [x: number, y: number]

/** How a path request stands: still searching, a path found, or no path at all. */
export type PathResult =
  | { status: 'searching' }
  | { status: 'found'; path: Point[]; cost: number }
  | { status: 'unreachable' }

interface Request {
  id: string
  from: Point
  to: Point
  costs: TerrainCosts
}

/**
 * Finds paths across the map with A*, a little at a time (T4.1): `advance` works through the
 * waiting requests until its time budget for this tick runs out and carries on next tick, so a
 * path across the whole disc never stalls the tick. Moves go to the four neighbouring tiles.
 * The search state is scratch memory, not world state; requests lost on a restart are simply
 * asked for again.
 */
export class PathFinder {
  private readonly n: number
  private readonly g: Float64Array
  private readonly cameFrom: Int32Array
  /** Which search last touched a tile, so the arrays never need clearing. */
  private readonly stamp: Uint32Array
  private readonly closed: Uint32Array
  private search = 0
  private heap = new MinHeap()

  private queue: Request[] = []
  private current: Request | undefined
  private results = new Map<string, PathResult>()

  constructor(private readonly terrain: TerrainMap) {
    this.n = terrain.diameter * terrain.diameter
    this.g = new Float64Array(this.n)
    this.cameFrom = new Int32Array(this.n)
    this.stamp = new Uint32Array(this.n)
    this.closed = new Uint32Array(this.n)
  }

  /** Asks for a path from one tile to another; replaces an earlier request with the same id. */
  request(id: string, from: Point, to: Point, costs: TerrainCosts = WALKING_COSTS): void {
    this.cancel(id)
    this.queue.push({ id, from, to, costs })
    this.results.set(id, { status: 'searching' })
  }

  /** Forgets a request and its result. */
  cancel(id: string): void {
    this.queue = this.queue.filter((r) => r.id !== id)
    if (this.current?.id === id) this.current = undefined
    this.results.delete(id)
  }

  /** The request's result so far; a found or unreachable result is handed out once. */
  result(id: string): PathResult | undefined {
    const r = this.results.get(id)
    if (r && r.status !== 'searching') this.results.delete(id)
    return r
  }

  /** How many requests are still being searched. */
  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0)
  }

  /** Works on waiting requests until `budgetMs` has passed. */
  advance(budgetMs: number, now: () => number = () => performance.now()): void {
    const deadline = now() + budgetMs
    while (now() < deadline) {
      if (!this.current) {
        const next = this.queue.shift()
        if (!next) return
        if (!this.start(next)) continue
      }
      const done = this.expand(1024)
      if (done) {
        this.results.set(this.current!.id, done)
        this.current = undefined
      }
    }
  }

  /** Searches to the end in one go, for tests and short paths. */
  findPath(from: Point, to: Point, costs: TerrainCosts = WALKING_COSTS): PathResult {
    const id = '\0now'
    this.request(id, from, to, costs)
    while (this.results.get(id)?.status === 'searching') this.advance(Infinity)
    return this.result(id)!
  }

  private passable(costs: TerrainCosts, x: number, y: number): boolean {
    return (
      isInsideDisc(this.terrain.diameter, x, y) &&
      costs[this.terrain.tiles[y * this.terrain.diameter + x]!]! < Infinity
    )
  }

  /** Begins a search; settles requests that need no search at all. */
  private start(req: Request): boolean {
    const [fx, fy] = req.from
    const [tx, ty] = req.to
    if (!this.passable(req.costs, fx, fy) || !this.passable(req.costs, tx, ty)) {
      this.results.set(req.id, { status: 'unreachable' })
      return false
    }
    if (fx === tx && fy === ty) {
      this.results.set(req.id, { status: 'found', path: [], cost: 0 })
      return false
    }
    this.search++
    this.heap.clear()
    const d = this.terrain.diameter
    const s = fy * d + fx
    this.stamp[s] = this.search
    this.g[s] = 0
    this.cameFrom[s] = -1
    this.heap.push(s, this.heuristic(req, fx, fy))
    this.current = req
    return true
  }

  /** The cheapest possible cost to the goal: every step on the cheapest terrain. */
  private heuristic(req: Request, x: number, y: number): number {
    const cheapest = Math.min(...Object.values(req.costs))
    return (Math.abs(x - req.to[0]) + Math.abs(y - req.to[1])) * cheapest
  }

  /** Expands up to `count` tiles of the current search; returns its result once it ends. */
  private expand(count: number): PathResult | undefined {
    const req = this.current!
    const { costs } = req
    const d = this.terrain.diameter
    const tiles = this.terrain.tiles
    const goal = req.to[1] * d + req.to[0]
    const cheapest = Math.min(...Object.values(costs))
    for (let i = 0; i < count; i++) {
      const t = this.heap.pop()
      if (t === undefined) return { status: 'unreachable' }
      if (this.closed[t] === this.search) continue
      this.closed[t] = this.search
      if (t === goal) return { status: 'found', path: this.pathTo(t), cost: this.g[t]! }
      const x = t % d
      const y = (t - x) / d
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x
        const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y
        if (!isInsideDisc(d, nx, ny)) continue
        const nt = ny * d + nx
        const step = costs[tiles[nt]!]!
        if (step === Infinity || this.closed[nt] === this.search) continue
        const g = this.g[t]! + step
        if (this.stamp[nt] === this.search && g >= this.g[nt]!) continue
        this.stamp[nt] = this.search
        this.g[nt] = g
        this.cameFrom[nt] = t
        const h = (Math.abs(nx - req.to[0]) + Math.abs(ny - req.to[1])) * cheapest
        this.heap.push(nt, g + h)
      }
    }
    return undefined
  }

  private pathTo(goal: number): Point[] {
    const d = this.terrain.diameter
    const path: Point[] = []
    for (let t = goal; this.cameFrom[t] !== -1; t = this.cameFrom[t]!)
      path.push([t % d, Math.floor(t / d)])
    return path.reverse()
  }
}

/** A binary min-heap of tile indices by priority, in growable typed arrays. */
class MinHeap {
  private items = new Int32Array(1024)
  private prio = new Float64Array(1024)
  private size = 0

  clear(): void {
    this.size = 0
  }

  push(item: number, priority: number): void {
    if (this.size === this.items.length) {
      const items = new Int32Array(this.size * 2)
      items.set(this.items)
      this.items = items
      const prio = new Float64Array(this.size * 2)
      prio.set(this.prio)
      this.prio = prio
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.prio[parent]! <= priority) break
      this.items[i] = this.items[parent]!
      this.prio[i] = this.prio[parent]!
      i = parent
    }
    this.items[i] = item
    this.prio[i] = priority
  }

  pop(): number | undefined {
    if (this.size === 0) return undefined
    const top = this.items[0]!
    const lastItem = this.items[--this.size]!
    const lastPrio = this.prio[this.size]!
    let i = 0
    for (;;) {
      let child = 2 * i + 1
      if (child >= this.size) break
      if (child + 1 < this.size && this.prio[child + 1]! < this.prio[child]!) child++
      if (this.prio[child]! >= lastPrio) break
      this.items[i] = this.items[child]!
      this.prio[i] = this.prio[child]!
      i = child
    }
    this.items[i] = lastItem
    this.prio[i] = lastPrio
    return top
  }
}
