import { FOOD_SPOIL_PER_DAY, TICKS_PER_GAME_DAY, type Stock, type WorldState } from '@csp/shared'
import { recordEvent } from './events.js'

/**
 * Spoilage (`CONTEXT.md`: Spoilage): at the end of each game day, `FOOD_SPOIL_PER_DAY` of the
 * Food in every place goes bad: in storages, carried by residents, on carriages and in piles.
 * Other goods keep. Goods stay whole units: the part of a unit left over spoils by chance, so on
 * average the share is exact, and the chance is drawn from the world's seed so a replay matches.
 * A pile left with nothing is gone. What a realm lost (in its cities' storages, its residents'
 * loads and its carriages) goes in its Player's log as one event.
 */
export function stepSpoilage(world: WorldState): void {
  if (world.tick % TICKS_PER_GAME_DAY !== TICKS_PER_GAME_DAY - 1) return
  const lost = new Map<string, number>()
  const spoil = (holder: string, stock: Stock | undefined, realmId: string | null = null) => {
    const food = stock?.food ?? 0
    if (!stock || food <= 0) return
    const due = food * FOOD_SPOIL_PER_DAY
    const units = Math.min(
      food,
      Math.floor(due) + (chance(world.seed, world.tick, holder) < due % 1 ? 1 : 0),
    )
    const left = food - units
    if (left > 0) stock.food = left
    else delete stock.food
    if (realmId !== null && units > 0) lost.set(realmId, (lost.get(realmId) ?? 0) + units)
  }
  const cityRealm = new Map(world.cities.map((c) => [c.id, c.realmId]))
  for (const b of world.buildings) {
    spoil(b.id, b.stock, b.cityId === null ? null : cityRealm.get(b.cityId))
  }
  for (const r of world.residents) spoil(r.id, r.carried, r.owner)
  for (const k of world.carriages) spoil(k.id, k.load, k.realmId)
  for (const p of world.piles) spoil(p.id, p.goods)
  world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
  for (const [realmId, units] of lost) recordEvent(world, realmId, { kind: 'foodSpoiled', units })
}

/** A number in [0, 1) that depends only on its inputs (FNV-1a hash, then an integer mix). */
function chance(seed: number, tick: number, id: string): number {
  let h = 0x811c9dc5
  for (const ch of `${seed}:${tick}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32
}
