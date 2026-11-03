import {
  type Carriage,
  type Good,
  type Horse,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { caravanCarriageStolen } from './caravans.js'
import { commitCrime, organizationName } from './crimes.js'
import { recordEvent } from './events.js'

/** What a resident takes in one go: a carriage with its hitched horse, or a horse alone. */
export interface Taken {
  carriage?: Carriage
  horse?: Horse
}

/** What of a load there is, as a crime and the log name it; undefined for none. */
function goodsOf(load: Stock | undefined): Stock | undefined {
  const entries = Object.entries(load ?? {}) as [Good, number][]
  const there = entries.filter(([, n]) => n > 0)
  return there.length > 0 ? (Object.fromEntries(there) as Stock) : undefined
}

/**
 * `thief` takes a carriage or horse of another organization for the realm `realmId`, on a map of
 * `size` tiles (`CONTEXT.md`: Stealing a carriage or horse), once the shared check allows it
 * (`driveOffProblem`, `takeProblem`). It joins that realm at once, a carriage with its load and
 * hitched horse, and leaves any alliance army. One theft, known through a witness; none when it
 * belonged to nobody. The owner's log says at once that it is gone and where it was last, without
 * the thief, and the thief's realm's log says what they took. A caravan's carriage robs the caravan
 * and is replaced (`caravanCarriageStolen`).
 */
export function takeOver(
  world: WorldState,
  thief: Resident,
  realmId: string,
  { carriage, horse }: Taken,
  size: number,
): void {
  const thing = carriage ?? horse
  if (!thing) return
  const victimOrg = thing.realmId ?? thing.cityId
  const what = {
    ...(carriage && { carriage: true as const }),
    ...(horse && { horse: horse.name }),
  }
  const goods = goodsOf(carriage?.load)
  const from = victimOrg === null ? null : organizationName(world, victimOrg)
  for (const t of [carriage, horse]) {
    if (!t) continue
    t.realmId = realmId
    t.cityId = null
    for (const a of world.alliances) a.army = a.army.filter((p) => p.id !== t.id)
  }
  commitCrime(world, size, 'theft', thief, { victimOrg, ...what, ...(goods && { goods }) })
  const { x, y } = thing
  recordEvent(world, victimOrg, { kind: 'transportGone', x, y, ...what })
  recordEvent(world, realmId, {
    kind: 'transportTaken',
    residentId: thief.id,
    name: thief.name,
    x,
    y,
    from,
    ...what,
    ...(goods && { goods }),
  })
  if (carriage) caravanCarriageStolen(world, thief, carriage)
}
