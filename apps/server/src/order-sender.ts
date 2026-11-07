import {
  commands,
  contractOf,
  isArmed,
  isBigNpcCity,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
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

/**
 * Why an NPC city's sender can't have a resident teach or train (`CONTEXT.md`: Who trains), if it
 * can't: of the game's cities, only a big one trains, and only its soldiers. A Player's sender needs
 * no such check.
 */
export function npcTrainingProblem(
  world: WorldState,
  sender: OrderSender,
  r: Resident,
): string | undefined {
  if (sender.npcCityId === undefined) return undefined
  const city = world.cities.find((c) => c.id === sender.npcCityId)
  if (!city || city.tradeOrg || !isBigNpcCity(world, city)) return 'this city trains nobody'
  return isArmed(r) ? undefined : 'it trains only its soldiers'
}
