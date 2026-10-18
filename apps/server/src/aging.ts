import {
  GOOD_WEIGHT,
  ageInYears,
  carryCapacity,
  stockWeight,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { dieAll, dropGoods } from './survival.js'

/** What aging did this tick. */
export interface AgingResult {
  /** Residents who died of old age this tick. */
  died: Resident[]
  /** Realms that ended because their Leader died of old age. */
  ended: Realm[]
}

/**
 * One tick of aging (`CONTEXT.md`: Aging): a resident who has reached their lifespan dies of old
 * age, dropping what they carried; a Leader's death ends their realm. Stats decline late in life
 * (`statValue`), so a resident whose Strength no longer carries their load puts down what is too
 * much on their tile, Food last.
 */
export function stepAging(world: WorldState): AgingResult {
  const died = world.residents.filter((r) => ageInYears(r, world.tick) >= r.lifespan)
  const ended = dieAll(world, died, 'oldAge')
  for (const r of world.residents) dropExcess(world, r)
  return { died, ended }
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
