import {
  CARRIAGE_SPEED,
  TERRAIN_SPEED,
  Terrain,
  tileIndex,
  wrap,
  wrapDelta,
  mayStep,
  strandedOnWall,
  type TerrainMap,
  type WallMap,
} from '@csp/shared'

/**
 * What crossing one tile of each terrain costs, in plains-tiles; Infinity can't be entered. A tile
 * with a road costs `Terrain.Road`'s, whatever the terrain beneath.
 */
export type TerrainCosts = Readonly<Record<number, number>>

/** Costs for someone on foot: the inverse of each terrain's speed. Lake and Sea are impassable. */
export const WALKING_COSTS: TerrainCosts = costsFrom(TERRAIN_SPEED)

/**
 * Costs for a carriage, from its speed on each terrain (`CONTEXT.md`: Carriage): cheap on plains,
 * dear in forest and hills, and mountains, lakes and sea can't be entered.
 */
export const CARRIAGE_COSTS: TerrainCosts = costsFrom(CARRIAGE_SPEED)

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

/** Who is going, for the walls and gates on the way (`mayStep`), and where to stop. */
export interface PathOptions {
  /**
   * The side of the one going (`wallSide`): their realm, or their NPC city. They may pass their
   * own gates and stand on their own walls.
   */
  realmId?: string | null
  /** On foot, so they may go onto their own walls; a carriage never does. */
  onWalls?: boolean
  /** Stop on any tile in contact with the goal (`inContact`) rather than on it: to attack. */
  near?: boolean
}

interface Request extends PathOptions {
  id: string
  from: Point
  to: Point
  costs: TerrainCosts
  /** The cheapest a step can cost, for the heuristic; set when the search starts. */
  cheapest?: number
  /** Whether the search starts stuck on a wall (`strandedOnWall`); set when it starts. */
  stranded?: boolean
}

/**
 * Finds paths across the map with A*, a little at a time (T4.1): `advance` works through the
 * waiting requests until its time budget for this tick runs out and carries on next tick, so a
 * path across the whole map never stalls the tick. Moves go to the four neighbouring tiles,
 * across the map's joins too. Tiles with a finished road (`setRoads`) cost a road's step, so
 * paths prefer roads (`CONTEXT.md`: Road). Walls and gates (`setWalls`) block the way as
 * `mayStep` says, for the realm a request names (`CONTEXT.md`: Walls in combat).
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
  /** 1 on tiles with a finished road. */
  private readonly road: Uint8Array
  private roadList: number[] = []
  private walls: WallMap | undefined
  private search = 0
  private heap = new MinHeap()

  private queue: Request[] = []
  private current: Request | undefined
  private results = new Map<string, PathResult>()

  constructor(private readonly terrain: TerrainMap) {
    this.n = terrain.size * terrain.size
    this.g = new Float64Array(this.n)
    this.cameFrom = new Int32Array(this.n)
    this.stamp = new Uint32Array(this.n)
    this.closed = new Uint32Array(this.n)
    this.road = new Uint8Array(this.n)
  }

  /**
   * The tiles with a finished road, as tile indices (`roadTiles`). Searches use them from the
   * next step they take; one under way keeps its heuristic.
   */
  setRoads(roads: Iterable<number>): void {
    for (const t of this.roadList) this.road[t] = 0
    this.roadList = [...roads]
    for (const t of this.roadList) this.road[t] = 1
  }

  /** The walls and gates on the map (`wallMap`); searches use them from the next step they take. */
  setWalls(walls: WallMap | undefined): void {
    this.walls = walls
  }

  /** What is underfoot on tile index `t`: a road, or the terrain. */
  private ground(t: number): number {
    return this.road[t] ? Terrain.Road : this.terrain.tiles[t]!
  }

  /** Asks for a path from one tile to another; replaces an earlier request with the same id. */
  request(
    id: string,
    from: Point,
    to: Point,
    costs: TerrainCosts = WALKING_COSTS,
    options: PathOptions = {},
  ): void {
    this.cancel(id)
    this.queue.push({ ...options, id, from, to, costs })
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
  findPath(
    from: Point,
    to: Point,
    costs: TerrainCosts = WALKING_COSTS,
    options: PathOptions = {},
  ): PathResult {
    const id = '\0now'
    this.request(id, from, to, costs, options)
    while (this.results.get(id)?.status === 'searching') this.advance(Infinity)
    return this.result(id)!
  }

  private passable(costs: TerrainCosts, x: number, y: number): boolean {
    return costs[this.ground(tileIndex(this.terrain.size, x, y))]! < Infinity
  }

  /**
   * Steps along both directions to the goal, the short way round the map; for a `near` request,
   * to the nearest tile in contact with it.
   */
  private stepsTo(req: Request, x: number, y: number): number {
    const { size } = this.terrain
    const dx = Math.abs(wrapDelta(x, req.to[0], size))
    const dy = Math.abs(wrapDelta(y, req.to[1], size))
    return req.near ? Math.max(0, dx - 1) + Math.max(0, dy - 1) : dx + dy
  }

  /** Whether the search may stop on (x, y): the goal, or for a `near` request beside it. */
  private reached(req: Request, x: number, y: number): boolean {
    if (!req.near) return x === req.to[0] && y === req.to[1]
    const { size } = this.terrain
    return (
      Math.abs(wrapDelta(x, req.to[0], size)) <= 1 && Math.abs(wrapDelta(y, req.to[1], size)) <= 1
    )
  }

  /** Whether the request may step from tile index `t` to the next tile `nt`, walls and gates aside. */
  private mayStep(req: Request, t: number, nt: number): boolean {
    if (!this.walls) return true
    const start = tileIndex(this.terrain.size, req.from[0], req.from[1])
    const stranded = !!req.stranded && t === start
    return mayStep(this.walls, req.realmId ?? null, t, nt, !!req.onWalls, stranded)
  }

  /** Begins a search; settles requests that need no search at all. */
  private start(req: Request): boolean {
    const { size } = this.terrain
    req.from = [wrap(req.from[0], size), wrap(req.from[1], size)]
    req.to = [wrap(req.to[0], size), wrap(req.to[1], size)]
    const [fx, fy] = req.from
    const [tx, ty] = req.to
    if (!this.passable(req.costs, fx, fy) || (!req.near && !this.passable(req.costs, tx, ty))) {
      this.results.set(req.id, { status: 'unreachable' })
      return false
    }
    if (this.reached(req, fx, fy)) {
      this.results.set(req.id, { status: 'found', path: [], cost: 0 })
      return false
    }
    this.search++
    this.heap.clear()
    const s = fy * size + fx
    this.stamp[s] = this.search
    this.g[s] = 0
    this.cameFrom[s] = -1
    req.stranded = !!this.walls && strandedOnWall(this.walls, req.realmId ?? null, s)
    // A road is the cheapest ground, but only counts while there are any: the heuristic stays as
    // sharp as it can, so searches stay short.
    const costs = Object.entries(req.costs)
      .filter(([t]) => Number(t) !== Terrain.Road || this.roadList.length > 0)
      .map(([, c]) => c)
    req.cheapest = Math.min(...costs)
    this.heap.push(s, this.stepsTo(req, fx, fy) * req.cheapest)
    this.current = req
    return true
  }

  /** Expands up to `count` tiles of the current search; returns its result once it ends. */
  private expand(count: number): PathResult | undefined {
    const req = this.current!
    const { costs } = req
    const d = this.terrain.size
    // The cheapest possible cost to the goal: every step on the cheapest ground.
    const cheapest = req.cheapest!
    for (let i = 0; i < count; i++) {
      const t = this.heap.pop()
      if (t === undefined) return { status: 'unreachable' }
      if (this.closed[t] === this.search) continue
      this.closed[t] = this.search
      const x = t % d
      const y = (t - x) / d
      if (this.reached(req, x, y))
        return { status: 'found', path: this.pathTo(t), cost: this.g[t]! }
      for (let k = 0; k < 4; k++) {
        // Past a side of the map, the step continues on the opposite side.
        const nx = wrap(k === 0 ? x + 1 : k === 1 ? x - 1 : x, d)
        const ny = wrap(k === 2 ? y + 1 : k === 3 ? y - 1 : y, d)
        const nt = ny * d + nx
        const step = costs[this.ground(nt)]!
        if (step === Infinity || this.closed[nt] === this.search) continue
        if (!this.mayStep(req, t, nt)) continue
        const g = this.g[t]! + step
        if (this.stamp[nt] === this.search && g >= this.g[nt]!) continue
        this.stamp[nt] = this.search
        this.g[nt] = g
        this.cameFrom[nt] = t
        const h = this.stepsTo(req, nx, ny) * cheapest
        this.heap.push(nt, g + h)
      }
    }
    return undefined
  }

  private pathTo(goal: number): Point[] {
    const d = this.terrain.size
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
