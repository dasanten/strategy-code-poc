import type { ScriptSummary } from '@csp/shared-types'
import { horsesInNeed } from '../transport/reviving.js'
import { isDown } from './world.js'
import { isWater } from './terrain.js'
import { targetParam } from '@csp/lang-wasm'
import { type PlanWorld } from '../queue/plan-step.js'
import { paramOnTile, type ParamWorld } from '../script/script-params-view.js'
import { useWorld } from './useWorld.js'

/** What the resident card's script param fields need of the world (`script-params-view`). */
export function paramWorld(world: NonNullable<ReturnType<typeof useWorld>['world']>): ParamWorld {
  const { buildings, carriages, cities, waypoints } = world
  const [lastSeen, realmId] = [world.lastSeen.buildings, world.home.realmId]
  return { buildings, lastSeen, carriages, cities, realmId, size: world.map.size, waypoints }
}
/**
 * For a default script's target param (`targetParam`), what it would be on the resident's tile,
 * which the script uses while none is picked; undefined for a script without one.
 */
export function targetOnTile(
  world: NonNullable<ReturnType<typeof useWorld>['world']>,
  script: ScriptSummary | undefined,
  at: { x: number; y: number },
): string | null | undefined {
  const name = script && targetParam(script)
  const param = script?.params.find((p) => p.name === name)
  if (!param || param.type === 'number') return undefined
  return paramOnTile(paramWorld(world), param.type, at)
}
/**
 * What the queue planner's map picks need of the world (`plan-step`), with what is known of the
 * terrain to tell the water from the shore.
 */
export function planWorld(
  world: NonNullable<ReturnType<typeof useWorld>['world']>,
  terrainAt?: (x: number, y: number) => number | undefined,
): PlanWorld {
  const water = (x: number, y: number) => {
    const t = terrainAt?.(x, y)
    return t !== undefined && isWater(t)
  }
  const { vessels } = world
  return { ...paramWorld(world), vessels, water, horses: world.horses, toFeed: toFeed(world) }
}
/**
 * Anyone Down in sight and any horse that isn't full as far as the Player knows, of any realm, to
 * Feed, most in need first (`CONTEXT.md`: Reviving, Feeding a horse).
 */
export function toFeed(world: NonNullable<ReturnType<typeof useWorld>['world']>) {
  return [...world.residents.filter(isDown), ...horsesInNeed(world.horses)]
}
