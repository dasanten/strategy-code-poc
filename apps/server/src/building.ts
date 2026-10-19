import {
  BUILDABLE,
  BUILD_WORK,
  MAP_SIZE,
  buildProblem,
  buildWork,
  buildingAt,
  canWork,
  constructionLearned,
  materialsNeeded,
  workNeeded,
  type BuildingKind,
  type OrderRequest,
  type TerrainMap,
  type WorldState,
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
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t build'
    if (!BUILDABLE.includes(o.building as BuildingKind)) return 'that can’t be built'
    const here = buildingAt(world, r.x, r.y)
    if (here?.site && here.kind === o.building) return undefined
    return buildProblem(world, r.x, r.y, o.building!, terrain)
  },
  apply(world, _sender, order) {
    const { residentId, building } = order as BuildRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'build', building, at: { x: r.x, y: r.y }, siteId: null }
  },
}

/** Requests this tick's build actions: laying out the site first, then work. */
export function requestBuilding(world: WorldState): BuildAction[] {
  const actions: BuildAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind === 'build') {
      actions.push({ kind: o.siteId === null ? 'layOut' : 'work', residentId: r.id })
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
 * (`updateCityMembership`).
 */
export function resolveBuilding(
  world: WorldState,
  actions: BuildAction[],
  terrain?: TerrainMap,
): void {
  let finished = false
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'build') continue
    if (r.x !== o.at.x || r.y !== o.at.y) {
      r.order = null
      continue
    }
    if (a.kind === 'layOut') {
      const here = buildingAt(world, r.x, r.y)
      if (here?.site && here.kind === o.building) o.siteId = here.id
      else if (buildProblem(world, r.x, r.y, o.building, terrain)) r.order = null
      else {
        const id = newId(world, 'b')
        world.buildings.push({
          id,
          kind: o.building,
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
  const sites = new Set(world.buildings.filter((b) => b.site).map((b) => b.id))
  for (const r of world.residents) {
    if (r.order?.kind === 'build' && r.order.siteId !== null && !sites.has(r.order.siteId)) {
      r.order = null
    }
  }
}
