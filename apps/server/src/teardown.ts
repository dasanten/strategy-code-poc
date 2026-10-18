import {
  buildWork,
  canWork,
  constructionLearned,
  tearDownProblem,
  teardownLeft,
  teardownReturns,
  teardownWork,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'
import { dropGoods } from './survival.js'

/** An action a resident with a tear-down order requests: put a tick's work into tearing down. */
export interface TearDownAction {
  residentId: string
}

/** The input of a tear-down order: which resident, and which building or site on their tile. */
interface TearDownRequest extends OrderRequest {
  kind: 'tearDown'
  residentId: string
  buildingId: string
}

/**
 * The tear-down order (`CONTEXT.md`: Tearing down): one of the Player's adult residents works at
 * taking down the building or construction site on their tile, whoever's it is. The work happens
 * in later ticks.
 */
export const tearDown: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<TearDownRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t tear down buildings'
    if (typeof o.buildingId !== 'string') return 'which building?'
    return tearDownProblem(world, r.x, r.y, o.buildingId)
  },
  apply(world, _sender, order) {
    const { residentId, buildingId } = order as TearDownRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'tearDown', buildingId, at: { x: r.x, y: r.y } }
  },
}

/** Requests this tick's tear-down work. */
export function requestTearingDown(world: WorldState): TearDownAction[] {
  return world.residents
    .filter((r) => r.order?.kind === 'tearDown')
    .map((r) => ({ residentId: r.id }))
}

/**
 * Resolves tear-down work (ADR 0002), one action after another. A resident who has left the tile
 * stops. Work goes into the building on the tile and teaches Construction; once enough is in, the
 * building or site is gone, its returned materials lie on the tile as goods, and everyone's build
 * or tear-down order on it is done.
 */
export function resolveTearingDown(world: WorldState, actions: TearDownAction[]): void {
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'tearDown') continue
    const b = world.buildings.find((x) => x.id === o.buildingId)
    if (!b || r.x !== o.at.x || r.y !== o.at.y || b.x !== r.x || b.y !== r.y) {
      r.order = null
      continue
    }
    if (teardownLeft(b) > 0) {
      b.teardown = Math.min(teardownWork(b), (b.teardown ?? 0) + buildWork(r, world.tick))
      r.skills.construction = (r.skills.construction ?? 0) + constructionLearned(r, world.tick)
    }
    if (teardownLeft(b) === 0) {
      world.buildings = world.buildings.filter((x) => x !== b)
      dropGoods(world, b.x, b.y, teardownReturns(b))
    }
  }
  const standing = new Set(world.buildings.map((b) => b.id))
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind === 'tearDown' && !standing.has(o.buildingId)) r.order = null
    if (o?.kind === 'build' && o.siteId !== null && !standing.has(o.siteId)) r.order = null
  }
}
