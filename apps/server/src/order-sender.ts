import { commands, contractOf, type City, type Resident, type WorldState } from '@csp/shared'
import type { OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'

/**
 * Who may order whom. Kept apart from `orders.ts`, which imports every order kind, so the order
 * kinds can use it without an import cycle.
 */

/** The sender for an NPC city running the game's default scripts for its residents. */
export function npcSender(city: Pick<City, 'id' | 'name'>): OrderSender {
  return { userId: 0, account: { name: city.name, isAdmin: false }, npcCityId: city.id }
}

/**
 * The resident an order names, if its sender may order them: one the Player commands, or, for
 * an NPC city's sender, one living in that city, of no realm and lent to nobody.
 */
export function orderedResident(
  world: WorldState,
  sender: OrderSender,
  residentId: unknown,
): Resident | undefined {
  const r = world.residents.find((x) => x.id === residentId)
  if (sender.npcCityId !== undefined) {
    const runs = r && r.owner === null && r.cityId === sender.npcCityId && !contractOf(world, r.id)
    return runs ? r : undefined
  }
  const realm = realmOf(world, sender.userId)
  return realm && commands(world, realm.id, r) ? r : undefined
}
