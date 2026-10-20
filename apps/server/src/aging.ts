import {
  GOOD_WEIGHT,
  ageInYears,
  canWork,
  carryCapacity,
  stockWeight,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { dieAll, dropGoods } from './survival.js'

/** What aging did this tick. */
export interface AgingResult {
  /** Residents who died of old age this tick. */
  died: Resident[]
  /** Realms that ended because their Leader died of old age. */
  ended: Realm[]
  /** Children who grew up this tick, so they can work from now on. */
  grown: Resident[]
}

/**
 * One tick of aging (`CONTEXT.md`: Aging, Child), run after the tick has advanced: a child who
 * reaches `ADULT_AGE` has grown up and goes in the Player's realm log; a resident who has reached
 * their lifespan dies of old age, dropping what they carried; a Leader's death ends their realm.
 * Stats decline late in life (`statValue`), so a resident whose Strength no longer carries their
 * load puts down what is too much on their tile, Food last. `size` is the map's.
 */
export function stepAging(world: WorldState, size: number): AgingResult {
  const grown = world.residents.filter((r) => canWork(r, world.tick) && !canWork(r, world.tick - 1))
  for (const r of grown) {
    recordEvent(world, r.owner, { kind: 'grownUp', residentId: r.id, name: r.name })
  }
  const died = world.residents.filter((r) => ageInYears(r, world.tick) >= r.lifespan)
  const ended = dieAll(world, died, 'oldAge', size)
  for (const r of world.residents) dropExcess(world, r)
  return { died, ended, grown }
}

/** Goods put down first when a load is too heavy: heaviest per unit first, Food last. */
const DROP_ORDER: Good[] = [
  ...(Object.keys(GOOD_WEIGHT) as Good[])
    .filter((g) => g !== 'food')
    .sort((a, b) => GOOD_WEIGHT[b] - GOOD_WEIGHT[a]),
  'food',
]

/** Puts down whole units until what the resident carries is within their carry capacity. */
function dropExcess(world: WorldState, r: Resident): void {
  let over = stockWeight(r.carried) - carryCapacity(r, world.tick)
  if (over <= 1e-9) return
  const dropped: Stock = {}
  for (const good of DROP_ORDER) {
    const have = r.carried[good] ?? 0
    if (have <= 0) continue
    const units = Math.min(have, Math.ceil(over / GOOD_WEIGHT[good] - 1e-9))
    dropped[good] = units
    if (units === have) delete r.carried[good]
    else r.carried[good] = have - units
    over -= units * GOOD_WEIGHT[good]
    if (over <= 1e-9) break
  }
  dropGoods(world, r.x, r.y, dropped)
}
