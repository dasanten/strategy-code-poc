import {
  BUILD_MATERIALS,
  nodeCorner,
  MAX_WORKERS,
  NODE_GOOD,
  NODE_WORKPLACE,
  NPC_ADULTS_PER_PAIR,
  NPC_FARM_REACH,
  NPC_NODE_REACH,
  NPC_WALL_STEP,
  buildProblem,
  buildingAt,
  cityAreaTiles,
  cityMembership,
  freeHousing,
  hasFoodSurplus,
  inCityArea,
  isCityBuilding,
  materialsNeeded,
  workNeeded,
  workplaceGood,
  wrap,
  wrapDelta,
  wrapDistance,
  type Building,
  type BuildingKind,
  type City,
  type CityProject,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
  isAt,
  footprintTiles,
  FOOTPRINT,
  NPC_WALL_TILES_PER_TRIP,
} from '@csp/shared'
import { hqGrows, hqProject } from './hq-growth.js'
import { walkTo } from './npc-behaviour.js'
import { npcSender } from './order-sender.js'
import { pair } from './pairing.js'
import { Ground } from './placing.js'

/**
 * How an NPC city grows (`CONTEXT.md`: NPC city): it pairs its adults, builds a house when it has a
 * food surplus and no free housing, a farm when every farm is full, and the workplace for a
 * material it needs but has no workplace for. With no room left inside its wall it builds on its
 * edge, puts up a new wall `NPC_WALL_STEP` tiles further out and then tears down the old one. All
 * through the orders a Player's residents take (ADR 0002). The Trade Org HQ grows this way only
 * while it is too weak, building round rings of its own (`hqProject`); trading posts never grow.
 * The city decides all this in its planning pass (`planCity`, ADR 0016) and keeps the project in
 * its plan; each tick it only gives its builders their part in it (`takePart`).
 */

/** Something an NPC city builds or takes down next, as its plan keeps it. */
export type Project = CityProject

/** A tile, relative to a city's home (`npcHome`), the short way round the map. */
interface Offset {
  dx: number
  dy: number
}

/** How far a tile is from the home along the farther direction: which ring of wall it is on. */
const ringOf = (o: Offset) => Math.max(Math.abs(o.dx), Math.abs(o.dy))

/**
 * The city's walls as rings round its home (`npcHome`): the innermost ring, the one it builds or
 * keeps (`outer`), and where the gate of each goes. Undefined for a city without walls, or one
 * whose walls stand at more distances than an old and a new ring.
 */
export interface Rings {
  inner: number
  outer: number
  /** It has outgrown its wall: a house outside it, or the new wall begun. */
  expanding: boolean
  /** The gate of the innermost ring, if it has one. */
  gate: Building | undefined
  /** Where the outer ring's gate goes: in line with the inner one's, or south of the home. */
  newGate: Offset
}

/**
 * Whether a city grows at all: an NPC city always, the Trade Organization's cities only while the
 * HQ is too weak (`hqGrows`); trading posts never.
 */
export function cityGrows(world: WorldState, city: City, adults: Resident[]): boolean {
  return !city.tradeOrg || (city.tradeOrg === 'hq' && hqGrows(world, adults))
}

/**
 * What a growing city builds or takes down next: the HQ its rings and houses (`hqProject`), an
 * NPC city whatever it wants most (`nextProject`).
 */
export function cityProject(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
): Project | undefined {
  return city.tradeOrg ? hqProject(world, city, terrain) : nextProject(world, city, home, terrain)
}

/**
 * Food runs short: the city's pairs with no child on the way end (`CONTEXT.md`: Pairing). A pair
 * whose child is on the way stays together until it is born.
 */
export function endPairs(world: WorldState, adults: Resident[]): void {
  for (const r of adults) if (r.pair && !r.carrying && !partnerCarrying(world, r)) delete r.pair
}

/**
 * Stops a builder who can do no more at their site until materials come (`canDoMore`), so the
 * city can give them something else to do.
 */
export function stopBuildersWhoCantGoOn(
  world: WorldState,
  adults: Resident[],
  storage: Building | undefined,
): void {
  for (const r of adults) {
    const o = r.order
    if (o?.kind !== 'build') continue
    const site = world.buildings.find((b) => b.id === o.siteId)
    if (site && site.site && !canDoMore(r, site, storage)) {
      r.order = null
      delete r.script
    }
  }
}

/**
 * Whether a builder can still help a site: it needs work, or materials they carry or the storage
 * holds (which its Build default fetches), or they are fetching some.
 */
export function canDoMore(r: Resident, site: Building, storage: Building | undefined): boolean {
  if (workNeeded(site) > 0 || r.script?.memory.fetch != null) return true
  const need = materialsNeeded(site)
  return pick(r.carried, need) !== undefined || pick(storage?.stock, need) !== undefined
}

/** Whether a resident is building (by the Build default or not), tearing down or delivering. */
export function isBuilder(r: Resident): boolean {
  const o = r.order
  return (
    (r.script?.scriptId === 0 && r.script.task === 'build') ||
    o?.kind === 'build' ||
    o?.kind === 'tearDown' ||
    (o?.kind === 'drop' && o.to.kind === 'site') ||
    (o?.kind === 'pickUp' && o.from.kind === 'storage' && !('food' in o.goods)) ||
    (o?.kind === 'fetch' && !('food' in o.goods))
  )
}

/** Whether a resident's partner carries their child. */
function partnerCarrying(world: WorldState, r: Resident): boolean {
  const partner = r.pair && world.residents.find((x) => x.id === r.pair!.partnerId)
  return !!partner && partner.carrying?.partnerId === r.id
}

/**
 * Pairs unpaired adults two by two (`CONTEXT.md`: Pairing) while the city has a food surplus,
 * until it holds one pair for every `NPC_ADULTS_PER_PAIR` adults, by the pairing order as a
 * Player would (ADR 0002). Pairing stops nobody's work; only the partner who comes to carry the
 * child does.
 */
export function pairAdults(world: WorldState, city: City, adults: Resident[]): void {
  if (!hasFoodSurplus(world, city)) return
  const pairs = adults.filter((r) => r.pair).length / 2
  let wanted = Math.floor(adults.length / NPC_ADULTS_PER_PAIR) - Math.floor(pairs)
  const single = adults.filter((r) => !r.pair && !r.carrying)
  const sender = npcSender(city)
  while (wanted > 0 && single.length >= 2) {
    const [a, b] = single.splice(0, 2) as [Resident, Resident]
    pair.apply(world, sender, { kind: 'pair', residentId: a.id, partnerId: b.id })
    wanted--
  }
}

/**
 * Gives a resident their part in a project, if there is one for them: walking to the tile and
 * tearing down there; or building it by the game's Build default (`CONTEXT.md`: Fetching
 * materials), which walks there, delivers what they carry of its materials and fetches what is
 * missing from the storage. For a tile of wall they first take enough for a few tiles from the
 * storage. False when they can't help, or the building to tear down is gone. With `deliver`, only
 * bringing materials they carry.
 */
export function takePart(
  world: WorldState,
  r: Resident,
  project: Project,
  storage: Building | undefined,
  deliver: boolean,
): boolean {
  if (deliver) {
    const site = project.kind === 'build' && buildingAt(world, project.x, project.y)
    const carries = site && site.site && pick(r.carried, materialsNeeded(site))
    // Carrying the materials of a few tiles of wall, they help with this one rather than take
    // them back to the storage; the next tiles will want them.
    const wall = project.kind === 'build' && forWall(project.building, r.carried)
    if (!carries && !wall) return false
  }
  if (project.kind === 'tearDown') {
    const b = world.buildings.find((x) => x.id === project.buildingId)
    if (!b) return false
    if (!isAt(r, b)) walkTo(r, b)
    else r.order = { kind: 'tearDown', buildingId: b.id, at: { x: r.x, y: r.y } }
    return true
  }
  const { x, y, building } = project
  const site = buildingAt(world, x, y)
  const build = () => {
    r.order = null
    r.script = { scriptId: 0, task: 'build', memory: { building, at: { x, y } } }
    return true
  }
  if (!site?.site) return build()
  const need = materialsNeeded(site)
  if (pick(r.carried, need)) return build()
  // For a tile of wall, enough for a few tiles at once: the rest goes to the next ones.
  const wall = building === 'wall' || building === 'gate'
  const stocked =
    wall &&
    !forWall(building, r.carried) &&
    pick(storage?.stock, times(need, NPC_WALL_TILES_PER_TRIP))
  if (storage && stocked) {
    if (isAt(r, storage)) {
      r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods: stocked }
    } else walkTo(r, storage)
    return true
  }
  return canDoMore(r, site, storage) && build()
}

/** Whether a resident carries materials for walls or gates, for a project of `building`. */
function forWall(building: BuildingKind, carried: Stock): boolean {
  if (building !== 'wall' && building !== 'gate') return false
  return pick(carried, BUILD_MATERIALS[building] ?? {}) !== undefined
}

/** `n` times the goods. */
function times(goods: Stock, n: number): Stock {
  const out: Stock = {}
  for (const [good, units] of Object.entries(goods) as [Good, number][]) out[good] = units * n
  return out
}

/** The goods of `wanted` that `stock` holds some of, as many as wanted; none if it holds none. */
function pick(stock: Stock | undefined, wanted: Stock): Stock | undefined {
  const out: Stock = {}
  for (const [good, units] of Object.entries(wanted) as [Good, number][]) {
    const have = stock?.[good] ?? 0
    if (have > 0) out[good] = Math.min(have, units)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * What an NPC city builds or takes down next, if anything: once its new wall is finished, the
 * old one, a stretch at a time and the gate last; else whatever it wants most (`wanted`). When
 * that needs a material the storage lacks and none of the city's workplaces makes, it is first
 * that material's workplace, on the nearest fitting resource node (`NPC_NODE_REACH`).
 */
export function nextProject(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
): Project | undefined {
  const rings = wallRings(world, city, home, terrain.size)
  const old = rings && oldWallToTearDown(world, city, home, terrain, rings)
  if (old) return { kind: 'tearDown', buildingId: old.id }
  const want = wanted(world, city, home, terrain, rings)
  if (!want) return undefined
  const site = buildingAt(world, want.x, want.y)
  const need = site?.site ? materialsNeeded(site) : (BUILD_MATERIALS[want.building] ?? {})
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  for (const [good, units] of Object.entries(need) as [Good, number][]) {
    if ((storage?.stock?.[good] ?? 0) >= units || makes(world, city, good)) continue
    const node = nearestNode(world, home, terrain, good)
    if (node) return { kind: 'build', building: NODE_WORKPLACE[node.node.kind], ...node.at }
  }
  return want
}

/** Whether one of the city's workplaces, finished or not, makes a good. */
function makes(world: WorldState, city: City, good: Good): boolean {
  const own = new Set(city.workplaceIds)
  return world.buildings.some(
    (b) => (b.cityId === city.id || own.has(b.id)) && workplaceGood(world, b) === good,
  )
}

/**
 * The nearest free resource node yielding `good` within `NPC_NODE_REACH` of the home, with where
 * its workplace goes (`nodeCorner`).
 */
function nearestNode(world: WorldState, home: Building, terrain: TerrainMap, good: Good) {
  let best:
    { node: (typeof world.nodes)[number]; at: { x: number; y: number }; d: number } | undefined
  for (const node of world.nodes) {
    if (NODE_GOOD[node.kind] !== good) continue
    const d = wrapDistance(terrain.size, home, node)
    if (d > NPC_NODE_REACH || (best && d >= best.d)) continue
    const at = nodeCorner(world, terrain, node)
    if (at) best = { node, at, d }
  }
  return best
}

/**
 * What the city wants built most, where: a site of its own already begun (a farm, a workplace of
 * its own, a house in its area, its new wall); else a farm when every farm is full; else a house
 * when it has a food surplus and no free housing; else the next stretch of its new wall.
 */
function wanted(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
  rings: Rings | undefined,
): Extract<Project, { kind: 'build' }> | undefined {
  const size = terrain.size
  const own = new Set(city.workplaceIds)
  const ring = rings?.expanding ? newWall(world, home, terrain, rings) : []
  const begun = world.buildings.find(
    (b) =>
      b.site &&
      (((b.kind === 'farm' || b.kind === 'stable') && b.cityId === city.id) ||
        own.has(b.id) ||
        (b.kind === 'house' && inCityArea(world, city, b.x, b.y, size))),
  )
  const wallSite = ring.find((t) => t.site)
  const site = begun ?? wallSite?.site
  if (site) return { kind: 'build', building: site.kind, x: site.x, y: site.y }
  const at = (building: BuildingKind, t: { x: number; y: number } | undefined) =>
    t && { kind: 'build' as const, building, x: t.x, y: t.y }
  if (farmsFull(world, city)) {
    const farm = at('farm', farmTile(world, home, terrain, rings))
    if (farm) return farm
  }
  if (hasFoodSurplus(world, city) && freeHousing(world, city) <= 0) {
    const house = at('house', houseTile(world, city, home, terrain, rings))
    if (house) return house
  }
  const next = ring.find((t) => !t.done)
  return next && { kind: 'build', building: next.kind, x: next.x, y: next.y }
}

/** Whether the city has farms and none of them has room for another worker, coming or there. */
function farmsFull(world: WorldState, city: City): boolean {
  const farms = world.buildings.filter((b) => b.kind === 'farm' && b.cityId === city.id && !b.site)
  if (farms.length === 0) return false
  return farms.every((f) => {
    const there = world.residents.filter(
      (r) =>
        r.script?.memory.workplaceId === f.id ||
        (r.order?.kind === 'workAt' && r.order.buildingId === f.id) ||
        (r.order?.kind === 'walkTo' && r.order.target.x === f.x && r.order.target.y === f.y),
    ).length
    return there >= (MAX_WORKERS.farm ?? 0)
  })
}

/**
 * The city's walls as rings round its home (`Rings`). A city expands once it has a house, finished
 * or begun, outside its innermost ring, or has begun its new wall `NPC_WALL_STEP` further out.
 */
export function wallRings(
  world: WorldState,
  city: City,
  home: Building,
  size: number,
): Rings | undefined {
  const off = (b: { x: number; y: number }): Offset => ({
    dx: wrapDelta(home.x, b.x, size),
    dy: wrapDelta(home.y, b.y, size),
  })
  const walls = world.buildings.filter(
    (b) => b.cityId === city.id && (b.kind === 'wall' || b.kind === 'gate') && !b.site,
  )
  if (walls.length === 0) return undefined
  const dists = walls.map((b) => ringOf(off(b)))
  const inner = Math.min(...dists)
  const outer = Math.max(...dists)
  const target = inner + NPC_WALL_STEP
  if (outer !== inner && outer !== target) return undefined
  const begun = world.buildings.some(
    (b) => (b.kind === 'wall' || b.kind === 'gate') && b.site && ringOf(off(b)) === target,
  )
  const outside = world.buildings.some(
    (b) =>
      b.kind === 'house' &&
      ringOf(off(b)) > inner &&
      (b.cityId === city.id || (b.site && inCityArea(world, city, b.x, b.y, size))),
  )
  const gate = walls.find((b) => b.kind === 'gate' && ringOf(off(b)) === inner)
  const g = gate && off(gate)
  const newGate =
    g && Math.abs(g.dy) === inner
      ? { dx: g.dx, dy: Math.sign(g.dy) * target }
      : g
        ? { dx: Math.sign(g.dx) * target, dy: g.dy }
        : { dx: 0, dy: target }
  const expanding = outer > inner || begun || outside
  return { inner, outer: expanding ? target : inner, expanding, gate, newGate }
}

/** A tile of a city's new wall: what goes there, and whether it is finished or begun. */
interface WallTileState {
  kind: 'wall' | 'gate'
  x: number
  y: number
  done: boolean
  site?: Building
}

/**
 * The tiles of the city's new wall (`Rings.outer`), the gate first and then on round the ring
 * from it, clockwise, so its builders work along the wall rather than back and forth across
 * the gate: each either finished, begun, or free for it. Tiles that can take no wall (a farm stands there,
 * a node, Mountain) are left out, and the wall has a gap there.
 */
export function newWall(
  world: WorldState,
  home: Building,
  terrain: TerrainMap,
  rings: Rings,
): WallTileState[] {
  const size = terrain.size
  const d = rings.outer
  const out: (WallTileState & { order: number })[] = []
  for (let dy = -d; dy <= d; dy++) {
    for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue
      const x = wrap(home.x + dx, size)
      const y = wrap(home.y + dy, size)
      const kind = dx === rings.newGate.dx && dy === rings.newGate.dy ? 'gate' : 'wall'
      const turn = Math.atan2(dy, dx) - Math.atan2(rings.newGate.dy, rings.newGate.dx)
      const order = (turn + 4 * Math.PI) % (2 * Math.PI)
      const here = buildingAt(world, x, y)
      if (here && (here.kind === 'wall' || here.kind === 'gate')) {
        out.push({
          kind: here.kind,
          x,
          y,
          done: !here.site,
          order,
          ...(here.site ? { site: here } : {}),
        })
      } else if (!buildProblem(world, x, y, kind, terrain)) {
        out.push({ kind, x, y, done: false, order })
      }
    }
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...t }) => t)
}

/**
 * The stretch of the old wall to tear down next, once every tile of the new wall is finished
 * (`CONTEXT.md`: NPC city), and only while the city's other buildings stay part of it without the
 * old wall: the stretch farthest along the wall from its gate, so the rest stays reachable from
 * the gate, and the gate last.
 */
function oldWallToTearDown(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
  rings: Rings,
): Building | undefined {
  if (rings.outer === rings.inner) return undefined
  if (newWall(world, home, terrain, rings).some((t) => !t.done)) return undefined
  const size = terrain.size
  const old = world.buildings.filter(
    (b) =>
      b.cityId === city.id &&
      (b.kind === 'wall' || b.kind === 'gate') &&
      !b.site &&
      Math.max(Math.abs(wrapDelta(home.x, b.x, size)), Math.abs(wrapDelta(home.y, b.y, size))) ===
        rings.inner,
  )
  const gone = new Set(old)
  const members = cityMembership(
    { cities: world.cities, buildings: world.buildings.filter((b) => !gone.has(b)) },
    size,
  )
  const cut = world.buildings.some(
    (b) =>
      b.cityId === city.id && isCityBuilding(b) && !gone.has(b) && members.get(b.id) !== city.id,
  )
  if (cut) return undefined
  // Distances along the old wall from its gate, four ways as residents walk.
  const byTile = new Map(old.map((b) => [`${b.x},${b.y}`, b]))
  const start = rings.gate && gone.has(rings.gate) ? rings.gate : old[0]
  if (!start) return undefined
  const dist = new Map<Building, number>([[start, 0]])
  const todo = [start]
  while (todo.length > 0) {
    const b = todo.shift()!
    for (const [nx, ny] of [
      [b.x + 1, b.y],
      [b.x - 1, b.y],
      [b.x, b.y + 1],
      [b.x, b.y - 1],
    ] as [number, number][]) {
      const n = byTile.get(`${wrap(nx, size)},${wrap(ny, size)}`)
      if (n && !dist.has(n)) {
        dist.set(n, dist.get(b)! + 1)
        todo.push(n)
      }
    }
  }
  // Stretches cut off from the gate go first; then the farthest; the gate last.
  const far = (b: Building) => dist.get(b) ?? Infinity
  return [...old].sort((a, b) => far(b) - far(a) || a.id.localeCompare(b.id))[0]
}

/** The rings round the home that a footprint's tiles lie on, nearest and farthest. */
function ringsOf(
  home: Building,
  b: { kind: BuildingKind; x: number; y: number },
  size: number,
): { near: number; far: number } {
  const rings = footprintTiles(b, size).map(([x, y]) =>
    ringOf({ dx: wrapDelta(home.x, x, size), dy: wrapDelta(home.y, y, size) }),
  )
  return { near: Math.min(...rings), far: Math.max(...rings) }
}

/**
 * Where the city puts its next house (`CONTEXT.md`: House), by the north-west tile of its
 * footprint: wholly on free ground of its area inside its wall, nearest its home first; when it is
 * expanding, inside the new wall. With no room left there, on its edge just outside the wall,
 * which starts its expansion. A city without walls builds anywhere in its area.
 */
export function houseTile(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
  rings: Rings | undefined,
): { x: number; y: number } | undefined {
  const size = terrain.size
  const area = cityAreaTiles(world, city, size)
  const ground = new Ground(world, terrain)
  const inArea = (x: number, y: number) => area.has(`${x},${y}`)
  const free = [...area]
    .map((k) => {
      const [x, y] = k.split(',').map(Number) as [number, number]
      return { x, y, ...ringsOf(home, { kind: 'house', x, y }, size) }
    })
    .filter((t) => ground.fits('house', t.x, t.y, inArea))
    .sort((a, b) => a.near - b.near || a.y - b.y || a.x - b.x)
  const at = (t: { x: number; y: number } | undefined) => t && { x: t.x, y: t.y }
  if (!rings) return at(free[0])
  const inside = free.find((t) => t.far < rings.outer)
  if (inside || rings.expanding) return at(inside)
  return at(free.find((t) => t.near === rings.inner + 1))
}

/**
 * Where the city lays out its next farm, by the north-west tile of its footprint: wholly on free
 * Plains beyond where its next wall would stand, nearest that wall first and then nearest its gate,
 * up to `NPC_FARM_REACH` further out, off the way out of its gate.
 */
export function farmTile(
  world: WorldState,
  home: Building,
  terrain: TerrainMap,
  rings: Rings | undefined,
): { x: number; y: number } | undefined {
  const size = terrain.size
  const wall = rings ? rings.outer : 0
  const gate = rings?.newGate ?? { dx: 0, dy: wall }
  const from = wall + NPC_WALL_STEP + 1
  const side = FOOTPRINT.farm
  const ground = new Ground(world, terrain)
  // Keep the way out of the gate open, and stay beyond the next wall.
  const fine = (x: number, y: number) => {
    const dx = wrapDelta(home.x, x, size)
    const dy = wrapDelta(home.y, y, size)
    const lane =
      Math.abs(gate.dy) >= Math.abs(gate.dx)
        ? dx === gate.dx && Math.sign(dy) === Math.sign(gate.dy)
        : dy === gate.dy && Math.sign(dx) === Math.sign(gate.dx)
    return !lane && ringOf({ dx, dy }) >= from
  }
  for (let d = from; d < from + NPC_FARM_REACH; d++) {
    let best: { x: number; y: number; dist: number } | undefined
    // North-west tiles of footprints whose nearest tile to the home is on ring `d`: touching it
    // from outside on one of its four sides.
    const candidates: [number, number][] = []
    for (let t = -d - side + 1; t <= d; t++) {
      candidates.push([t, -d - side + 1], [t, d], [-d - side + 1, t], [d, t])
    }
    for (const [dx, dy] of candidates) {
      const x = wrap(home.x + dx, size)
      const y = wrap(home.y + dy, size)
      if (!ground.fits('farm', x, y, fine)) continue
      const dist = Math.hypot(dx + (side - 1) / 2 - gate.dx, dy + (side - 1) / 2 - gate.dy)
      if (!best || dist < best.dist) best = { x, y, dist }
    }
    if (best) return { x: best.x, y: best.y }
  }
  return undefined
}
