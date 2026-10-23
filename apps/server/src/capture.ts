import {
  captorOf,
  drivenCarriageId,
  inCityArea,
  realmName,
  type Carriage,
  type City,
  type Horse,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'

/** A city that changed realm by capture this tick. */
export interface Capture {
  cityId: string
  /** The realm it belonged to; null for an NPC city. */
  from: string | null
  to: string
}

/**
 * Captures every city that has a captor (`captorOf`, `CONTEXT.md`: Capturing a city), on a map
 * of `size` tiles. Runs last in the tick, once fights, deaths and dropped weapons are settled.
 */
export function stepCaptures(world: WorldState, size: number): Capture[] {
  const captures: Capture[] = []
  for (const city of world.cities) {
    const captor = captorOf(world, city, size)
    if (captor === null || captor === city.realmId) continue
    captures.push({ cityId: city.id, from: city.realmId, to: captor })
    captureCity(world, city, captor, size)
  }
  return captures
}

/**
 * A city joins the realm `captor` with everything in it (`CONTEXT.md`: Capturing a city,
 * Integrating): its buildings, the residents who live there, wherever they stand, loyal at once,
 * and the horses and carriages of its former owner standing in its area. A Leader is never
 * captured: one who lived there stays in their realm and is homeless. Those who join drop the
 * orders their former owner gave them, and their pair unless the partner joins too; whoever else
 * drove a carriage that joins stops driving it, and nobody keeps attacking their own realm. Both
 * realms' logs show it.
 */
export function captureCity(world: WorldState, city: City, captor: string, size: number): void {
  const from = city.realmId
  const residents = joinRealm(world, city, captor, size)
  const what = { kind: 'cityCaptured', cityId: city.id, city: city.name, residents } as const
  recordEvent(world, captor, { ...what, other: from && realmName(world, from), captor: true })
  recordEvent(world, from, { ...what, other: realmName(world, captor), captor: false })
}

/**
 * A city joins the realm `captor` with everything in it, as `captureCity` says, whether captured
 * or bought (`CONTEXT.md`: Buying a city). Returns how many of its residents joined.
 */
export function joinRealm(world: WorldState, city: City, captor: string, size: number): number {
  const from = city.realmId
  const leaders = new Set(world.realms.map((r) => r.leaderId))
  const joining = world.residents.filter((r) => r.cityId === city.id && !leaders.has(r.id))
  const joined = new Set(joining.map((r) => r.id))
  for (const r of world.residents) {
    if (r.cityId !== city.id) continue
    if (joined.has(r.id)) {
      r.owner = captor
      r.order = null
      if (r.pair && !joined.has(r.pair.partnerId)) delete r.pair
    } else {
      r.cityId = null
      delete r.pair
    }
  }
  const inArea = (t: { x: number; y: number }) => inCityArea(world, city, t.x, t.y, size)
  // Its former owner's: of its realm, or for an NPC city, of the city itself.
  const fromOwner = (t: Horse | Carriage) =>
    t.realmId === from && (from !== null || t.cityId === city.id) && inArea(t)
  const join = (t: Horse | Carriage) => {
    t.realmId = captor
    t.cityId = null
  }
  const carriages = new Set<string>()
  for (const k of world.carriages) {
    if (!fromOwner(k)) continue
    join(k)
    carriages.add(k.id)
    const horse = world.horses.find((h) => h.id === k.horseId)
    if (horse) join(horse)
  }
  for (const h of world.horses) if (fromOwner(h)) join(h)
  const owners = new Map(world.residents.map((r) => [r.id, r.owner]))
  for (const r of world.residents) {
    const driven = drivenCarriageId(r)
    if (driven && carriages.has(driven) && !joined.has(r.id)) r.order = null
    const o = r.order
    if (o?.kind === 'attack' && r.owner !== null && owners.get(o.targetId) === r.owner)
      r.order = null
  }
  city.realmId = captor
  return joining.length
}
