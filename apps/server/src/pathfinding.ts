import {
  CARRIAGE_SPEED,
  DIAGONAL_STEP,
  PATH_DETOUR_LIMIT,
  PATH_DETOUR_SLACK,
  TERRAIN_SPEED,
  Terrain,
  WALL_ENCLOSES_MAX,
  isPassableTerrain,
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
 * dear in forest and hills; lakes, sea and mountains can't be entered, mountains except on a road.
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

const tables = new WeakMap<TerrainCosts, Float64Array>()

/** The costs as a typed array by ground, for the search's inner loop; one per set of costs. */
function tableOf(costs: TerrainCosts): Float64Array {
  let table = tables.get(costs)
  if (!table) {
    table = new Float64Array(256)
    for (let t = 0; t < 256; t++) table[t] = costs[t] ?? Infinity
    tables.set(costs, table)
  }
  return table
}

/**
 * Side of the window that short paths are searched in (`PathFinder`), in tiles. A path whose ends
 * lie within a quarter of it along each direction counts as short.
 */
export const LOCAL_SIDE = 1024

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
  /** The costs by ground (`tableOf`); set when the request is checked. */
  table?: Float64Array
  /** The cheapest a step can cost, for the heuristic; set when the request is checked. */
  cheapest?: number
  /** The start's tile index; set when the request is checked. */
  start?: number
  /** Whether the search starts stuck on a wall (`strandedOnWall`); set when it is checked. */
  stranded?: boolean
  /** Whether the quick checks before any search (`check`) have run. */
  checked?: boolean
}

/** `Ground.flags` bits. */
const ROAD = 1
const WALL = 2

/** What the searches step across: the terrain, its roads, and the walls and gates on it. */
class Ground {
  readonly size: number
  readonly tiles: Uint8Array
  /** Per tile: `ROAD` where a finished road is, `WALL` where a wall or gate stands. */
  readonly flags: Uint8Array
  walls: WallMap | undefined
  private roadList: number[] = []
  private wallList: number[] = []

  constructor(terrain: TerrainMap) {
    this.size = terrain.size
    this.tiles = terrain.tiles
    this.flags = new Uint8Array(terrain.size * terrain.size)
  }

  setRoads(roads: Iterable<number>): void {
    for (const t of this.roadList) this.flags[t]! &= ~ROAD
    this.roadList = [...roads]
    for (const t of this.roadList) this.flags[t]! |= ROAD
  }

  get hasRoads(): boolean {
    return this.roadList.length > 0
  }

  setWalls(walls: WallMap | undefined): void {
    if (walls === this.walls) return
    for (const t of this.wallList) this.flags[t]! &= ~WALL
    this.walls = walls
    this.wallList = walls ? [...walls.tiles.keys()] : []
    for (const t of this.wallList) this.flags[t]! |= WALL
  }

  /** What is underfoot on tile index `t`: a road, or the terrain. */
  at(t: number): number {
    return this.flags[t]! & ROAD ? Terrain.Road : this.tiles[t]!
  }

  /** Whether the request may step from tile index `t` to the next tile `nt`, walls and gates aside. */
  mayStep(req: Request, t: number, nt: number): boolean {
    if (!this.walls || !((this.flags[t]! | this.flags[nt]!) & WALL)) return true
    const stranded = !!req.stranded && t === req.start
    return mayStep(this.walls, req.realmId ?? null, t, nt, !!req.onWalls, stranded)
  }
}

/** A region label for land that falls into too many small regions to label each. */
const MANY = 0xffff

const regionCache = new WeakMap<Uint8Array, Map<Float64Array, Uint16Array>>()

/**
 * Labels each tile with the stretch of land it lies in for a traveller with these costs: tiles
 * with the same label reach each other, walls and gates aside, tiles with different ones never.
 * 0 can't be entered. Where these costs let a road be crossed, any passable land counts as
 * entered, road or not yet: a road on Mountain joins a carriage's stretches, and roads come and
 * go (`CONTEXT.md`: Road). Diagonal steps don't join stretches, as they never cut a corner. The
 * terrain never changes, so the labels are worked out once per map and set of costs.
 */
function regionsOf(ground: Ground, table: Float64Array): Uint16Array {
  let byTable = regionCache.get(ground.tiles)
  if (!byTable) regionCache.set(ground.tiles, (byTable = new Map()))
  const known = byTable.get(table)
  if (known) return known
  const { size, tiles } = ground
  const n = size * size
  const road = table[Terrain.Road]! < Infinity
  const passable = (t: number) => {
    const terrain = tiles[t]!
    return table[terrain]! < Infinity || (road && isPassableTerrain(terrain))
  }
  const labels = new Uint16Array(n)
  const stack = new Int32Array(n)
  let next = 1
  for (let s = 0; s < n; s++) {
    if (labels[s] !== 0 || !passable(s)) continue
    const label = next < MANY ? next++ : MANY
    labels[s] = label
    let top = 0
    stack[top++] = s
    while (top > 0) {
      const t = stack[--top]!
      const x = t % size
      const row = t - x
      const ns = [
        row + (x + 1 === size ? 0 : x + 1),
        row + (x === 0 ? size - 1 : x - 1),
        (t + size) % n,
        (t - size + n) % n,
      ]
      for (const nt of ns) {
        if (labels[nt] !== 0 || !passable(nt)) continue
        labels[nt] = label
        stack[top++] = nt
      }
    }
  }
  byTable.set(table, labels)
  return labels
}

/**
 * How far the goal is in straight steps, the short way round the map, going diagonally as far as
 * that helps (a diagonal step counting `DIAGONAL_STEP`); for a `near` request, to the nearest tile
 * in contact with it.
 */
function stepsTo(req: Request, size: number, x: number, y: number): number {
  let dx = Math.abs(wrapDelta(x, req.to[0], size))
  let dy = Math.abs(wrapDelta(y, req.to[1], size))
  if (req.near) {
    dx = Math.max(0, dx - 1)
    dy = Math.max(0, dy - 1)
  }
  return dx > dy ? dx + (DIAGONAL_STEP - 1) * dy : dy + (DIAGONAL_STEP - 1) * dx
}

/** Whether a search may stop on (x, y): the goal, or for a `near` request beside it. */
function reached(req: Request, size: number, x: number, y: number): boolean {
  if (!req.near) return x === req.to[0] && y === req.to[1]
  return (
    Math.abs(wrapDelta(x, req.to[0], size)) <= 1 && Math.abs(wrapDelta(y, req.to[1], size)) <= 1
  )
}

/**
 * One A* search at a time over a square window of the map, the whole map or a smaller one, kept
 * in typed arrays the size of the window. Tiles outside the window can't be entered. A search
 * gives up once every way left would cost more than `PATH_DETOUR_LIMIT` allows.
 */
class Search {
  /** Whether the window is the whole map, so its sides join. */
  readonly full: boolean
  /** Cost so far to each tile, in single precision: plenty across the map, at half the memory. */
  private readonly g: Float32Array
  private readonly cameFrom: Int32Array
  /** `2 * search` on tiles this search has reached, one more once they are closed. */
  private readonly stamp: Uint32Array
  private search = 0
  private readonly heap = new MinHeap()
  /** The window's north-west corner on the map. */
  private x0 = 0
  private y0 = 0
  private limit = Infinity
  private req: Request | undefined
  /** Whether the search came up against a side of its window, so a way may lie beyond it. */
  clipped = false

  constructor(
    private readonly ground: Ground,
    readonly side: number,
  ) {
    this.full = side === ground.size
    const n = side * side
    this.g = new Float32Array(n)
    this.cameFrom = new Int32Array(n)
    this.stamp = new Uint32Array(n)
  }

  /** Starts on a checked request, with the window centred between its ends. */
  begin(req: Request): void {
    const { size } = this.ground
    const [fx, fy] = req.from
    const [tx, ty] = req.to
    const half = this.side / 2
    this.x0 = this.full ? 0 : wrap(fx + Math.round(wrapDelta(fx, tx, size) / 2) - half, size)
    this.y0 = this.full ? 0 : wrap(fy + Math.round(wrapDelta(fy, ty, size) / 2) - half, size)
    this.search++
    this.heap.clear()
    this.clipped = false
    const l = wrap(fy - this.y0, size) * this.side + wrap(fx - this.x0, size)
    this.stamp[l] = 2 * this.search
    this.g[l] = 0
    this.cameFrom[l] = -1
    const best = stepsTo(req, size, fx, fy) * req.cheapest!
    this.limit = PATH_DETOUR_LIMIT * best + PATH_DETOUR_SLACK * req.table![Terrain.Plains]!
    this.heap.push(l, best)
    this.req = req
  }

  /** Expands up to `count` tiles; returns the result once the search ends. */
  expand(count: number): PathResult | undefined {
    const req = this.req!
    const { size } = this.ground
    const side = this.side
    const closed = 2 * this.search + 1
    for (let i = 0; i < count; i++) {
      if (this.heap.top > this.limit) return { status: 'unreachable' }
      const l = this.heap.pop()
      if (l === undefined) return { status: 'unreachable' }
      if (this.stamp[l] === closed) continue
      this.stamp[l] = closed
      const lx = l % side
      const ly = (l - lx) / side
      const x = this.x0 + lx < size ? this.x0 + lx : this.x0 + lx - size
      const y = this.y0 + ly < size ? this.y0 + ly : this.y0 + ly - size
      if (reached(req, size, x, y))
        return { status: 'found', path: this.pathTo(l), cost: this.g[l]! }
      const t = y * size + x
      // Past a side of the map, the step continues on the opposite side.
      const e = x + 1 === size ? 0 : x + 1
      const w = x === 0 ? size - 1 : x - 1
      const s = y + 1 === size ? 0 : y + 1
      const n = y === 0 ? size - 1 : y - 1
      this.visit(req, t, l, e, y, lx + 1, ly, false)
      this.visit(req, t, l, w, y, lx - 1, ly, false)
      this.visit(req, t, l, x, s, lx, ly + 1, false)
      this.visit(req, t, l, x, n, lx, ly - 1, false)
      this.visit(req, t, l, e, s, lx + 1, ly + 1, true)
      this.visit(req, t, l, w, s, lx - 1, ly + 1, true)
      this.visit(req, t, l, e, n, lx + 1, ly - 1, true)
      this.visit(req, t, l, w, n, lx - 1, ly - 1, true)
    }
    return undefined
  }

  /**
   * Considers the step from tile `t` (window tile `l`) to (nx, ny), window tile (nlx, nly). A
   * `diagonal` step costs `DIAGONAL_STEP` times as much, and only goes where both straight tiles
   * beside it could be stepped onto too (`CONTEXT.md`: Step).
   */
  private visit(
    req: Request,
    t: number,
    l: number,
    nx: number,
    ny: number,
    nlx: number,
    nly: number,
    diagonal: boolean,
  ): void {
    const side = this.side
    if (nlx < 0 || nlx >= side || nly < 0 || nly >= side) {
      if (!this.full) {
        this.clipped = true
        return
      }
      nlx = nx
      nly = ny
    }
    const ground = this.ground
    const nt = ny * ground.size + nx
    const table = req.table!
    let step = table[ground.at(nt)]!
    if (step === Infinity) return
    const nl = nly * side + nlx
    const stamp = this.stamp[nl]
    if (stamp === 2 * this.search + 1) return
    if (!ground.mayStep(req, t, nt)) return
    if (diagonal) {
      const a = t - (t % ground.size) + nx
      const b = nt - nx + (t % ground.size)
      if (table[ground.at(a)] === Infinity || table[ground.at(b)] === Infinity) return
      if (!ground.mayStep(req, t, a) || !ground.mayStep(req, t, b)) return
      step *= DIAGONAL_STEP
    }
    const g = Math.fround(this.g[l]! + step)
    if (stamp === 2 * this.search && g >= this.g[nl]!) return
    this.stamp[nl] = 2 * this.search
    this.g[nl] = g
    this.cameFrom[nl] = l
    this.heap.push(nl, g + stepsTo(req, ground.size, nx, ny) * req.cheapest!)
  }

  private pathTo(goal: number): Point[] {
    const { size } = this.ground
    const side = this.side
    const path: Point[] = []
    for (let l = goal; this.cameFrom[l] !== -1; l = this.cameFrom[l]!)
      path.push([(this.x0 + (l % side)) % size, (this.y0 + Math.floor(l / side)) % size])
    return path.reverse()
  }
}

/** Requests waiting for one `Search`, and the one it is working on. */
interface Lane {
  search: Search
  queue: Request[]
  current: Request | undefined
}

/**
 * Finds paths across the map with A*, a little at a time (T4.1): `advance` works through the
 * waiting requests until its time budget for this tick runs out and carries on next tick, so a
 * path across the whole map never stalls the tick. Moves go to the eight tiles around, across
 * the map's joins too; a diagonal one costs `DIAGONAL_STEP` times as much and never cuts a corner
 * (`CONTEXT.md`: Step). Tiles with a finished road (`setRoads`) cost a road's step, so
 * paths prefer roads (`CONTEXT.md`: Road). Walls and gates (`setWalls`) block the way as
 * `mayStep` says, for the realm a request names (`CONTEXT.md`: Walls in combat).
 *
 * Short paths go in their own lane, searched in a `LOCAL_SIDE` window, so a long search under
 * way never holds them up; one that finds no way within its window tries the whole map. A goal
 * on land the start can't reach (`regionsOf`), or shut in by walls the one going can't pass, is
 * unreachable before any search.
 *
 * The search state is scratch memory, not world state; requests lost on a restart are simply
 * asked for again.
 */
export class PathFinder {
  private readonly ground: Ground
  private readonly local: Lane
  private readonly global: Lane
  private results = new Map<string, PathResult>()

  constructor(terrain: TerrainMap, localSide = LOCAL_SIDE) {
    this.ground = new Ground(terrain)
    const lane = (side: number): Lane => ({
      search: new Search(this.ground, side),
      queue: [],
      current: undefined,
    })
    this.global = lane(terrain.size)
    this.local = localSide < terrain.size ? lane(localSide) : this.global
    // Labelled up front for the usual travellers, so no tick waits on it.
    regionsOf(this.ground, tableOf(WALKING_COSTS))
    regionsOf(this.ground, tableOf(CARRIAGE_COSTS))
  }

  /**
   * The tiles with a finished road, as tile indices (`roadTiles`). Searches use them from the
   * next step they take; one under way keeps its heuristic.
   */
  setRoads(roads: Iterable<number>): void {
    this.ground.setRoads(roads)
  }

  /** The walls and gates on the map (`wallMap`); searches use them from the next step they take. */
  setWalls(walls: WallMap | undefined): void {
    this.ground.setWalls(walls)
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
    const { size } = this.ground
    const reach = this.local.search.side / 4
    const short =
      Math.abs(wrapDelta(from[0], to[0], size)) <= reach &&
      Math.abs(wrapDelta(from[1], to[1], size)) <= reach
    ;(short ? this.local : this.global).queue.push({ ...options, id, from, to, costs })
    this.results.set(id, { status: 'searching' })
  }

  /** Forgets a request and its result. */
  cancel(id: string): void {
    for (const lane of this.lanes()) {
      lane.queue = lane.queue.filter((r) => r.id !== id)
      if (lane.current?.id === id) lane.current = undefined
    }
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
    let n = 0
    for (const lane of this.lanes()) n += lane.queue.length + (lane.current ? 1 : 0)
    return n
  }

  /**
   * Works on waiting requests until `budgetMs` has passed: short ones first, but while long ones
   * wait, they get at least half the budget.
   */
  advance(budgetMs: number, now: () => number = () => performance.now()): void {
    const deadline = now() + budgetMs
    if (this.local !== this.global) {
      const longWaiting = !!this.global.current || this.global.queue.length > 0
      this.work(this.local, longWaiting ? now() + budgetMs / 2 : deadline, now)
    }
    this.work(this.global, deadline, now)
    if (this.local !== this.global) this.work(this.local, deadline, now)
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

  private lanes(): Lane[] {
    return this.local === this.global ? [this.global] : [this.local, this.global]
  }

  /** Works through one lane's requests until `deadline`. */
  private work(lane: Lane, deadline: number, now: () => number): void {
    while (now() < deadline) {
      if (!lane.current) {
        const next = lane.queue.shift()
        if (!next) return
        if (!next.checked) {
          next.checked = true
          const settled = this.check(next)
          if (settled) {
            this.results.set(next.id, settled)
            continue
          }
        }
        lane.search.begin(next)
        lane.current = next
      }
      const done = lane.search.expand(1024)
      if (!done) continue
      const req = lane.current
      lane.current = undefined
      // No way within the window; there may be one round outside it.
      if (done.status === 'unreachable' && lane.search.clipped) this.global.queue.push(req)
      else this.results.set(req.id, done)
    }
  }

  /**
   * Readies a request for its search, and settles it at once if it needs none: already there,
   * or the goal can't be entered, lies on land the start can't reach, or is shut in.
   */
  private check(req: Request): PathResult | undefined {
    const ground = this.ground
    const { size } = ground
    req.from = [wrap(req.from[0], size), wrap(req.from[1], size)]
    req.to = [wrap(req.to[0], size), wrap(req.to[1], size)]
    const table = (req.table = tableOf(req.costs))
    const s = tileIndex(size, req.from[0], req.from[1])
    const goal = tileIndex(size, req.to[0], req.to[1])
    req.start = s
    if (table[ground.at(s)] === Infinity || (!req.near && table[ground.at(goal)] === Infinity))
      return { status: 'unreachable' }
    if (reached(req, size, req.from[0], req.from[1])) return { status: 'found', path: [], cost: 0 }
    const regions = regionsOf(ground, table)
    const region = regions[s]!
    if (region !== MANY) {
      const goals: number[] = [goal]
      if (req.near)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            goals.push(tileIndex(size, req.to[0] + dx, req.to[1] + dy))
      if (goals.every((t) => regions[t] !== region && regions[t] !== MANY))
        return { status: 'unreachable' }
    }
    const walls = ground.walls
    req.stranded = !!walls && strandedOnWall(walls, req.realmId ?? null, s)
    if (!req.near && walls?.inside.has(goal) && this.shutIn(req, goal))
      return { status: 'unreachable' }
    // A road is the cheapest ground, but only counts while there are any: the heuristic stays as
    // sharp as it can, so searches stay short.
    let cheapest = Infinity
    for (let t = 0; t < 256; t++)
      if (t !== Terrain.Road || ground.hasRoads) cheapest = Math.min(cheapest, table[t]!)
    req.cheapest = cheapest
    return undefined
  }

  /**
   * Whether the goal, inside a ring of walls, can't be reached from the start: going back from
   * it, every way ends at walls or gates the one going can't pass. Gives up (false) once it is
   * out of the ring, or past the most a ring can shut in. Going straight is enough: a diagonal
   * step never cuts a corner, so it never gets out where straight ones can't.
   */
  private shutIn(req: Request, goal: number): boolean {
    const ground = this.ground
    const walls = ground.walls!
    const { size } = ground
    const n = size * size
    const seen = new Set([goal])
    const todo = [goal]
    while (todo.length > 0) {
      const t = todo.pop()!
      const x = t % size
      const row = t - x
      const ns = [
        row + (x + 1 === size ? 0 : x + 1),
        row + (x === 0 ? size - 1 : x - 1),
        (t + size) % n,
        (t - size + n) % n,
      ]
      for (const p of ns) {
        if (seen.has(p) || req.table![ground.at(p)] === Infinity) continue
        if (!ground.mayStep(req, p, t)) continue
        if (p === req.start || (!walls.inside.has(p) && !walls.tiles.has(p))) return false
        seen.add(p)
        if (seen.size > WALL_ENCLOSES_MAX) return false
        todo.push(p)
      }
    }
    return true
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

  /** The lowest priority waiting; Infinity when empty. */
  get top(): number {
    return this.size > 0 ? this.prio[0]! : Infinity
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
