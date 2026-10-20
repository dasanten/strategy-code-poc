import {
  commands,
  ROAD_LINE_MAX_TILES,
  MAP_SIZE,
  buildProblem,
  canWork,
  materialsNeeded,
  roadAt,
  roadLine as lineTiles,
  type Good,
  type OrderRequest,
  type Stock,
  type WorldState,
} from '@csp/shared'
import type { CarryAction } from './carrying.js'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/** The input of a road order along a line: which resident, and the line's two end tiles. */
interface RoadLineRequest extends OrderRequest {
  kind: 'roadLine'
  residentId: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

const isTile = (t: unknown): t is { x: number; y: number } =>
  typeof t === 'object' &&
  t !== null &&
  Number.isInteger((t as { x: unknown }).x) &&
  Number.isInteger((t as { y: unknown }).y)

/**
 * The road order along a line (`CONTEXT.md`: Road): one of the Player's adult residents builds a
 * road on each tile of the straight line from `from` to `to` (`roadLine`), one after another,
 * walking from tile to tile. Every tile must take a road or have one already; tiles that have one
 * are skipped. It only sets the order; walking, laying out and working happen in later ticks.
 */
export const roadLine: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<RoadLineRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t build'
    if (!isTile(o.from) || !isTile(o.to)) return 'the line must run between two tiles'
    const tiles = lineTiles(o.from, o.to, terrain?.size ?? MAP_SIZE)
    if (tiles.length > ROAD_LINE_MAX_TILES) {
      return `a road order covers at most ${ROAD_LINE_MAX_TILES} tiles`
    }
    for (const [x, y] of tiles) {
      if (roadAt(world, x, y)) continue
      const problem = buildProblem(world, x, y, 'road', terrain)
      if (problem) return `(${x}, ${y}): ${problem}`
    }
    return undefined
  },
  apply(world, _sender, order, terrain) {
    const { residentId, from, to } = order as RoadLineRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (!r) return
    r.order = {
      kind: 'roadLine',
      tiles: lineTiles(from, to, terrain?.size ?? MAP_SIZE),
      phase: 'walking',
      path: null,
      progress: 0,
      siteId: null,
    }
  },
}

/**
 * Requests this tick's puts of materials from road orders along a line: a resident on the road
 * site of their tile puts in what they carry of what it still needs.
 */
export function requestRoadMaterials(world: WorldState): CarryAction[] {
  const actions: CarryAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'roadLine' || o.phase !== 'building' || o.siteId === null) continue
    const site = world.buildings.find((b) => b.id === o.siteId)
    if (!site?.site || site.x !== r.x || site.y !== r.y) continue
    const goods: Stock = {}
    for (const [good, units] of Object.entries(materialsNeeded(site)) as [Good, number][]) {
      const held = Math.min(units, r.carried[good] ?? 0)
      if (held > 0) goods[good] = held
    }
    if (Object.keys(goods).length === 0) continue
    actions.push({ kind: 'put', residentId: r.id, spot: { kind: 'site', siteId: site.id }, goods })
  }
  return actions
}
