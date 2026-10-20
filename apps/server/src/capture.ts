import {
  captorOf,
  drivenCarriageId,
  inCityArea,
  realmName,
  type City,
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
 * orders their former owner gave them, except pairing with a partner who joins too; whoever else
 * drove a carriage that joins stops driving it, and nobody keeps attacking their own realm. Both
 * realms' logs show it.
 */
export function captureCity(world: WorldState, city: City, captor: string, size: number): void {
  const from = city.realmId
  const leaders = new Set(world.realms.map((r) => r.leaderId))
  const joining = world.residents.filter((r) => r.cityId === city.id && !leaders.has(r.id))
  const joined = new Set(joining.map((r) => r.id))
  for (const r of world.residents) {
    if (r.cityId !== city.id) continue
    const o = r.order
    if (joined.has(r.id)) {
      r.owner = captor
      if (!(o?.kind === 'pair' && joined.has(o.partnerId))) r.order = null
    } else {
      r.cityId = null
      if (o?.kind === 'pair') r.order = null
    }
  }
  const inArea = (t: { x: number; y: number }) => inCityArea(world, city, t.x, t.y, size)
  const carriages = new Set<string>()
  for (const k of world.carriages) {
    if (k.realmId !== from || !inArea(k)) continue
    k.realmId = captor
    carriages.add(k.id)
    const horse = world.horses.find((h) => h.id === k.horseId)
    if (horse) horse.realmId = captor
  }
  for (const h of world.horses) if (h.realmId === from && inArea(h)) h.realmId = captor
  const owners = new Map(world.residents.map((r) => [r.id, r.owner]))
  for (const r of world.residents) {
    const driven = drivenCarriageId(r)
    if (driven && carriages.has(driven) && !joined.has(r.id)) r.order = null
    const o = r.order
    if (o?.kind === 'attack' && r.owner !== null && owners.get(o.targetId) === r.owner)
      r.order = null
  }
  city.realmId = captor
  const what = {
    kind: 'cityCaptured',
    cityId: city.id,
    city: city.name,
    residents: joining.length,
  } as const
  recordEvent(world, captor, { ...what, other: from && realmName(world, from), captor: true })
  recordEvent(world, from, { ...what, other: realmName(world, captor), captor: false })
}
