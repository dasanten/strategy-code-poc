import {
  FEED_UNITS,
  NPC_REVIVE_REACH,
  OWN_FOOD,
  canWork,
  cityResidents,
  freeStock,
  inContact,
  isArmed,
  isAt,
  isDown,
  nearCityArea,
  npcStorages,
  unitsThatFit,
  wrapDistance,
  type Building,
  type City,
  type CityJob,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { haul, walkTo } from './npc-behaviour.js'

/*
 * A city the game runs revives its own (`CONTEXT.md`: Reviving). Its planning pass gives one grown
 * resident per Down resident a `revive` job (ADR 0016); between passes the city walks them through
 * it with orders a Player could give (`runReviver`, ADR 0002): take Food at the storage, walk there,
 * Feed. A reviver lost on the way is replaced at the next pass, which sees the Down resident still
 * has nobody.
 */

/**
 * The city's Down residents it fetches, soonest to die first, by id (`CONTEXT.md`: Reviving): those
 * in its area or within `NPC_REVIVE_REACH` of it, while its storage holds Food. `size` is the map's.
 */
export function downToRevive(world: WorldState, city: City, size: number): Map<string, Resident> {
  const storage = npcStorages(world, city)[0]
  if (!storage || (freeStock(world, storage).food ?? 0) < 1) return new Map()
  const down = cityResidents(world, city)
    .filter(
      (r) =>
        r.owner === null &&
        isDown(r) &&
        nearCityArea(world, city, r.x, r.y, NPC_REVIVE_REACH, size),
    )
    .sort((a, b) => a.downUntil! - b.downUntil!)
  return new Map(down.map((r) => [r.id, r]))
}

/**
 * Whether the job of the last pass still stands: a reviver goes on while the one they go to is still
 * waiting, and is the one reviver of them, so they are taken off `waiting`.
 */
export function goesOnReviving(job: CityJob | undefined, waiting: Map<string, Resident>): boolean {
  return job?.kind === 'revive' && waiting.delete(job.targetId ?? '')
}

/**
 * Sends a reviver to each Down resident `waiting` (`CONTEXT.md`: Reviving), nearest first, never a
 * soldier or one carrying a child: spare hands (`spare`, who have no job yet); then workers, then
 * builders; and last farmers, but only while Food isn't short (`foodShort`), as Food for those who
 * aren't Down comes first. `leave` is told of whoever gives up a job for it.
 */
export function sendRevivers(
  waiting: Map<string, Resident>,
  spare: Resident[],
  adults: Resident[],
  jobs: Record<string, CityJob>,
  foodShort: boolean,
  size: number,
  leave: (r: Resident) => void,
): void {
  const byJob = (kind: CityJob['kind']) => adults.filter((r) => jobs[r.id]?.kind === kind)
  for (const target of waiting.values()) {
    const ranks = [
      () => spare.filter((r) => jobs[r.id] === undefined),
      () => byJob('work'),
      () => byJob('build'),
      () => (foodShort ? [] : byJob('farm')),
    ]
    let reviver: Resident | undefined
    for (const rank of ranks) {
      reviver = nearest(rank(), target, size)
      if (reviver) break
    }
    if (!reviver) return
    leave(reviver)
    jobs[reviver.id] = { kind: 'revive', targetId: target.id }
  }
}

/** Of `people`, the one nearest `to`. */
function nearest(people: Resident[], to: Resident, size: number): Resident | undefined {
  let best: { r: Resident; d: number } | undefined
  for (const r of people) {
    const d = wrapDistance(size, r, to)
    if (!best || d < best.d) best = { r, d }
  }
  return best?.r
}

/** The Down resident a `revive` job goes to, undefined once they are awake or dead. */
export function reviveTarget(world: WorldState, job: CityJob | undefined): Resident | undefined {
  if (job?.kind !== 'revive') return undefined
  const target = world.residents.find((x) => x.id === job.targetId)
  return target && isDown(target) ? target : undefined
}

/**
 * What an idle reviver does next (`CONTEXT.md`: Reviving): beside the Down resident with Food in
 * hand, Feeds them; else takes what they give from the storage on top of their own Food, putting any
 * load of goods away there first, and walks to them. Whether they were given something to do; not
 * when there is nobody to go to any more, or no Food to take to them.
 */
export function runReviver(
  world: WorldState,
  r: Resident,
  job: CityJob | undefined,
  storage: Building | undefined,
  size: number,
): boolean {
  const target = reviveTarget(world, job)
  if (!target) return false
  const hand = r.carried.food ?? 0
  if (hand >= 1 && inContact(size, r, target)) {
    r.order = { kind: 'feed', targetId: target.id, units: FEED_UNITS }
    return true
  }
  const wanted = OWN_FOOD + FEED_UNITS - hand
  const food = storage ? (freeStock(world, storage).food ?? 0) : 0
  if (storage && food > 0 && wanted > 0) {
    if (!isAt(r, storage, size)) {
      walkTo(r, storage)
      return true
    }
    const to = { kind: 'storage' as const, storageId: storage.id }
    const load = haul(r, { food: 1 })
    if (load) {
      r.order = { kind: 'drop', to, goods: load }
      return true
    }
    const units = Math.min(food, wanted, unitsThatFit(r, 'food', world.tick))
    if (units > 0) {
      r.order = { kind: 'pickUp', from: to, goods: { food: units } }
      return true
    }
  }
  if (hand < 1) return false
  walkTo(r, target)
  return true
}

/**
 * An NPC city's revivers are as the rule says (`CONTEXT.md`: Reviving; ADR 0004), in the plan its
 * pass made this tick: each a grown resident who isn't Down, no soldier and not carrying a child;
 * one per Down resident; and a Down resident they go to lies within reach of the city.
 */
export const npcRevivers: Invariant = {
  name: 'npc-revivers',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const residents = new Map(world.residents.map((r) => [r.id, r]))
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const city = world.cities.find((c) => c.id === cityId)
      if (!city || plan.plannedAt !== world.tick) continue
      const seen = new Set<string>()
      for (const [residentId, job] of Object.entries(plan.jobs)) {
        if (job.kind !== 'revive') continue
        const fail = (message: string, ...ids: string[]) =>
          out.push({
            invariant: this.name,
            message: `${cityId} sends ${residentId} to revive: ${message}`,
            entityIds: [cityId, residentId, ...ids],
          })
        const r = residents.get(residentId)
        if (r && !canWork(r, world.tick)) fail('a child')
        if (r && isDown(r)) fail('who is Down')
        if (r && isArmed(r)) fail('a soldier')
        if (r?.carrying) fail('who carries a child')
        const targetId = job.targetId ?? ''
        if (seen.has(targetId)) fail(`a second reviver of ${targetId}`, targetId)
        seen.add(targetId)
        const target = residents.get(targetId)
        if (
          target &&
          isDown(target) &&
          !nearCityArea(world, city, target.x, target.y, NPC_REVIVE_REACH, terrain.size)
        ) {
          fail(`${targetId} lies out of its reach`, targetId)
        }
      }
    }
    return out
  },
}
