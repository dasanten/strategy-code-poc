import {
  BUILDABLE,
  BUILD_WORK,
  MAP_SIZE,
  buildProblem,
  buildWork,
  canWork,
  constructionAt,
  constructionLearned,
  materialsNeeded,
  workNeeded,
  type BuildOrder,
  type BuildingKind,
  type OrderRequest,
  type Resident,
  type ResidentOrder,
  type RoadLineOrder,
  type TerrainMap,
  type WorldState,
  commands,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { foundCity, updateCityMembership } from './cities.js'
import { newId, realmOf } from './starting-city.js'

/**
 * An action a resident with a build order requests: lay out the construction site on their tile,
 * or put a tick's work into it. The world checks and resolves it at the end of the tick.
 */
export interface BuildAction {
  kind: 'layOut' | 'work'
  residentId: string
}

/** The input of a build order: which resident, and what to build on the tile they stand on. */
interface BuildRequest extends OrderRequest {
  kind: 'build'
  residentId: string
  building: BuildingKind
}

/**
 * The build order (`CONTEXT.md`: Building): one of the Player's adult residents lays out a
 * construction site on the tile they stand on, or joins the unfinished one of that kind already
 * there, and works on it until it is finished. Laying out and working happen in later ticks.
 */
export const build: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<BuildRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || !commands(world, realm.id, r)) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t build'
    if (!BUILDABLE.includes(o.building as BuildingKind)) return 'that can’t be built'
    const here = constructionAt(world, r.x, r.y, o.building!)
    if (here?.site && here.kind === o.building) return undefined
    return buildProblem(world, r.x, r.y, o.building!, terrain)
  },
  apply(world, _sender, order) {
    const { residentId, building } = order as BuildRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'build', building, at: { x: r.x, y: r.y }, siteId: null }
  },
}

/**
 * What a resident is building, and where: a build order, or a road order along a line that is
 * building on its next tile. Nothing otherwise.
 */
export function buildingPart(
  o: ResidentOrder | null,
):
  | { order: BuildOrder | RoadLineOrder; building: BuildingKind; at: { x: number; y: number } }
  | undefined {
  if (o?.kind === 'build') return { order: o, building: o.building, at: o.at }
  if (o?.kind === 'roadLine' && o.phase === 'building') {
    return { order: o, building: 'road', at: { x: o.tiles[0]![0], y: o.tiles[0]![1] } }
  }
  return undefined
}

/**
 * A road order along a line goes on to its next tile, walking there; after the last it is done.
 * Any other order is done.
 */
export function nextTile(r: Resident): void {
  const o = r.order
  if (o?.kind !== 'roadLine' || o.tiles.length <= 1) {
    r.order = null
    return
  }
  o.tiles.shift()
  o.phase = 'walking'
  o.path = null
  o.progress = 0
  o.siteId = null
}

/** Requests this tick's build actions: laying out the site first, then work. */
export function requestBuilding(world: WorldState): BuildAction[] {
  const actions: BuildAction[] = []
  for (const r of world.residents) {
    const part = buildingPart(r.order)
    if (part) {
      actions.push({ kind: part.order.siteId === null ? 'layOut' : 'work', residentId: r.id })
    }
  }
  return actions
}

/**
 * Resolves build actions (ADR 0002), one after another. A resident who has left the tile stops.
 * Laying out joins an unfinished site of the same kind already on the tile, or else lays out a new
 * one where the building may go; otherwise the order ends. Work goes into the site on the tile,
 * up to what it needs, and teaches Construction. A site with all its materials and work becomes
 * the building, and everyone's build order for it is done. A finished town hall founds a city of
 * the realm whose resident finished it, and any finished city building may grow a city
 * (`updateCityMembership`). A road order along a line builds its tiles this way: where its tile
 * can't take a road (it has one already) and once that road is finished, it goes on to the next.
 */
export function resolveBuilding(
  world: WorldState,
  actions: BuildAction[],
  terrain?: TerrainMap,
): void {
  let finished = false
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const part = buildingPart(r?.order ?? null)
    if (!r || !part) continue
    const o = part.order
    if (r.x !== part.at.x || r.y !== part.at.y) {
      r.order = null
      continue
    }
    if (a.kind === 'layOut') {
      const here = constructionAt(world, r.x, r.y, part.building)
      if (here?.site && here.kind === part.building) o.siteId = here.id
      else if (buildProblem(world, r.x, r.y, part.building, terrain)) nextTile(r)
      else {
        const id = newId(world, 'b')
        world.buildings.push({
          id,
          kind: part.building,
          cityId: null,
          x: r.x,
          y: r.y,
          site: { delivered: {}, work: 0 },
        })
        o.siteId = id
      }
      continue
    }
    const site = world.buildings.find((b) => b.id === o.siteId)
    if (!site?.site || site.x !== r.x || site.y !== r.y) {
      r.order = null
      continue
    }
    if (workNeeded(site) > 0) {
      site.site.work = Math.min(
        BUILD_WORK[site.kind] ?? 0,
        site.site.work + buildWork(r, world.tick),
      )
      r.skills.construction = (r.skills.construction ?? 0) + constructionLearned(r, world.tick)
    }
    if (workNeeded(site) === 0 && Object.keys(materialsNeeded(site)).length === 0) {
      delete site.site
      finished = true
      if (site.kind === 'townHall') foundCity(world, site, r.owner)
    }
  }
  if (finished) updateCityMembership(world, terrain?.size ?? MAP_SIZE)
  // Orders on a site that is finished go on (a road order to its next tile); on one that is gone, they end.
  const built = new Map(world.buildings.map((b) => [b.id, !b.site]))
  for (const r of world.residents) {
    const siteId = buildingPart(r.order)?.order.siteId
    if (siteId === undefined || siteId === null || built.get(siteId) === false) continue
    if (built.get(siteId)) nextTile(r)
    else r.order = null
  }
}
