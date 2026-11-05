import {
  HORSE_FOOD_PER_DAY,
  HORSE_HUNGRY_SHARE,
  MAX_HUNGER,
  NPC_STABLE_HUNGRY_DAYS,
  NPC_STABLE_REFILL_DAYS,
  NPC_TRADE,
  STABLE_FEED_DAYS,
  cityFoodUse,
  horsesIn,
  isArmed,
  ownsHorse,
  storedFood,
  type Building,
  type City,
  type CityJob,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * An NPC city feeds its stable (`CONTEXT.md`: NPC horses, Feeding the stable): one of its residents
 * runs the game's Feed the stable default, as a Player's would. The city only says who, and how much
 * Food they may take (`memory.spareFood`): its people come first.
 */

/** What a stable of an NPC city needs for its own horses in it now. */
interface StableNeed {
  stable: Building
  /** Hungry or Down horses of the city in it. */
  hungry: number
  /** Whether it is time to send a feeder: a horse is hungry, or the stable is running low. */
  due: boolean
  /**
   * Whole units of Food the city lets go to it now: what is above the reserve for its people, or
   * below that a little for each hungry horse (`NPC_STABLE_HUNGRY_DAYS`), and no more than the
   * stable lacks.
   */
  food: number
}

function stableNeed(world: WorldState, city: City, stable: Building): StableNeed | undefined {
  const own = horsesIn(world.horses, stable).filter((h) => ownsHorse({ cityId: city.id }, h))
  if (own.length === 0) return undefined
  const held = stable.stock?.food ?? 0
  const lacks = own.length * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY - held
  if (lacks <= 0) return undefined
  const hungry = own.filter((h) => h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER).length
  const stored = storedFood(world, city)
  // Food for its horses is in the reserve too (`npcStablesLack`), but it is there to go to them:
  // what the feeder may not touch is only what its people eat.
  const spare = stored - cityFoodUse(world, city, NPC_TRADE.reserveFoodDays)
  const meals = Math.ceil(hungry * NPC_STABLE_HUNGRY_DAYS * HORSE_FOOD_PER_DAY)
  const food = Math.floor(Math.min(Math.ceil(lacks), stored, Math.max(spare, meals)))
  const low = held < own.length * NPC_STABLE_REFILL_DAYS * HORSE_FOOD_PER_DAY
  return { stable, hungry, due: food >= 1 && (hungry > 0 || low), food }
}

/** Whether a resident is running the Feed the stable default for the city that runs them. */
function isFeeder(r: Resident): boolean {
  return r.script?.scriptId === 0 && r.script.task === 'feedStable'
}

/**
 * The job of a resident already feeding, for a planning pass: they go on while the stable needs Food
 * the city can let go, and until the Food they fetched is in it. Undefined once they are done.
 */
export function feedJobKept(world: WorldState, city: City, r: Resident): CityJob | undefined {
  if (!isFeeder(r)) return undefined
  const stableId = r.script!.memory.stableId
  if (typeof stableId !== 'string') return undefined
  const stable = world.buildings.find((b) => b.id === stableId)
  if (!stable) return undefined
  const under = r.order !== null || r.script!.memory.fetched != null
  const need = stableNeed(world, city, stable)
  return under || (need?.food ?? 0) >= 1 ? { kind: 'feed', stableId } : undefined
}

/**
 * Who feeds a stable that is due (`CONTEXT.md`: NPC horses), part of a planning pass with no feeder
 * out: the stable with hungry horses first, then the first running low. The one sent is idle if any
 * is, else at a workplace, else on a farm, as nothing else stands between the horses and hunger;
 * never a soldier, one carrying a child or a builder. Whether one was sent; their job becomes `feed`.
 */
export function planFeeder(
  world: WorldState,
  city: City,
  adults: Resident[],
  jobs: Record<string, CityJob>,
): boolean {
  const needs: StableNeed[] = []
  for (const b of world.buildings) {
    if (b.kind !== 'stable' || b.site || b.cityId !== city.id) continue
    const need = stableNeed(world, city, b)
    if (need?.due) needs.push(need)
  }
  const need = needs.find((n) => n.hungry > 0) ?? needs[0]
  if (!need) return false
  const rank = (r: Resident) => {
    if (isArmed(r) || r.carrying || r.script?.task === 'breed') return undefined
    const kind = jobs[r.id]?.kind
    return kind === 'idle' ? 0 : kind === 'work' ? 1 : kind === 'farm' ? 2 : undefined
  }
  const hands = adults.filter((r) => rank(r) !== undefined)
  hands.sort((a, b) => rank(a)! - rank(b)!)
  const r = hands[0]
  if (!r) return false
  jobs[r.id] = { kind: 'feed', stableId: need.stable.id }
  return true
}

/**
 * Between passes: a feeder the pass just let go stops; one still feeding is told how much Food the
 * city lets go now. Their own run of the default does the rest.
 */
export function steerFeeder(
  world: WorldState,
  city: City,
  r: Resident,
  job: CityJob | undefined,
  planned: boolean,
): 'stop' | undefined {
  if (!isFeeder(r)) return undefined
  if (job?.kind !== 'feed') return planned ? 'stop' : undefined
  const stable = world.buildings.find((b) => b.id === job.stableId)
  r.script!.memory.spareFood = (stable && stableNeed(world, city, stable)?.food) ?? 0
  return undefined
}

/**
 * Puts a resident with a `feed` job to feeding: they run the game's Feed the stable default. Whether
 * they were given it: not once the stable is gone.
 */
export function startFeeding(world: WorldState, city: City, r: Resident, job: CityJob): boolean {
  const stable = world.buildings.find((b) => b.id === job.stableId)
  if (!stable || stable.site) return false
  const spareFood = stableNeed(world, city, stable)?.food ?? 0
  r.script = { scriptId: 0, task: 'feedStable', memory: { stableId: stable.id, spareFood } }
  return true
}

/**
 * One feeder at a time (`CONTEXT.md`: NPC horses; ADR 0004): no city the game runs has more than one
 * of its residents running the game's Feed the stable default, none of them in the Trade
 * Organization's cities, which don't take part.
 */
export const npcOneFeeder: Invariant = {
  name: 'npc-one-feeder',
  check(world) {
    const out: InvariantViolation[] = []
    const byCity = new Map<string, string[]>()
    for (const r of world.residents) {
      if (r.owner !== null || r.cityId === null || !isFeeder(r)) continue
      byCity.set(r.cityId, [...(byCity.get(r.cityId) ?? []), r.id])
    }
    for (const [cityId, ids] of byCity) {
      const tradeOrg = world.cities.find((c) => c.id === cityId)?.tradeOrg
      if (ids.length > 1 || tradeOrg) {
        out.push({
          invariant: this.name,
          message: `${cityId}${tradeOrg ? ', of the Trade Organization,' : ''} has ${ids.join(', ')} feeding its stable`,
          entityIds: [cityId, ...ids],
        })
      }
    }
    return out
  },
}
