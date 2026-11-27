import { holdersOf, isSiegeSite, SHARES_A_TILE } from '../building/building.js'
import type { Building, Resident, SeenResident } from '@csp/shared-types'
import { carriagePulledBy } from '../transport/carriages.js'
import { riderOf } from '../transport/horse-rules.js'
import { horseToSteal, rowOffProblem } from '../world/world-rules.js'
import { isAt } from '../building/footprint.js'
import { PASSENGER_WEIGHT } from '@csp/balance'
import { besideVessel, crewShort, vesselOfResident, vesselRoom } from '../transport/vessels.js'
import { commandedCarriages, strangersCarriage } from '../screen/selection-view.js'

import type { ClientWorld } from '../world/useWorld.js'

/**
 * What is on or beside the picked resident's tile that their card offers orders about: the
 * building and road they stand at, carriages, boats and horses of theirs and of others
 * (`CONTEXT.md`: At a building, Beside a vessel, Stealing a carriage or horse).
 */
export function whatsHere(world: ClientWorld | null, selected: Resident | undefined) {
  const onTile = <T extends { x: number; y: number }>(things: T[] | undefined) =>
    selected && things?.find((t) => t.x === selected.x && t.y === selected.y)
  // A road may share its tile with a building (`CONTEXT.md`: Road); a building is wherever its
  // footprint is (`CONTEXT.md`: At a building).
  const buildingHere =
    selected && world?.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && isAt(selected, b))
  const roadHere = onTile(world?.buildings.filter((b) => b.kind === 'road'))
  // A carriage or siege machine site on the tile, worked and supplied the same way (`CONTEXT.md`: Siege machine).
  const carriageSiteHere = onTile(
    world?.buildings.filter((b) => b.kind === 'carriage' || isSiegeSite(b.kind)),
  )
  const armyCarriages = commandedCarriages(world?.diplomacy.alliance, world?.home.realmId)
  const isStrangers = (k: { id: string; realmId: string | null }) =>
    strangersCarriage(k, world?.home.realmId, armyCarriages)
  const ownCarriageHere = onTile(world?.carriages.filter((k) => !isStrangers(k)))
  // The boat of the realm the picked resident is aboard, else one beside them, to row
  // (`CONTEXT.md`: Rowing); boarding from beside it, the one at its oars becomes a passenger.
  const boatToRow = ((): { id: string; problem?: string; ship?: boolean } | undefined => {
    if (!selected || !world) return undefined
    // One of a ship's crew aboard it sails it, with enough crew (`CONTEXT.md`: Sailing).
    const crewed = world.vessels.find(
      (v) => v.kind === 'ship' && v.id === selected.aboard && v.crewIds.includes(selected.id),
    )
    if (crewed) {
      const short = crewShort(crewed)
      const problem = short > 0 ? `the ship needs ${short} more crew to sail` : undefined
      return { id: crewed.id, ship: true, ...(problem ? { problem } : {}) }
    }
    // On the haven a ship of theirs is docked at, they may take it on a haul route as its captain
    // (`CONTEXT.md`: Haul route by water), with enough crew aboard once they board too.
    const docked =
      selected.aboard === undefined
        ? world.vessels.find(
            (v) =>
              v.kind === 'ship' &&
              vesselOfResident(v, selected) &&
              besideVessel(v, selected, world.map.size, world.buildings),
          )
        : undefined
    if (docked) {
      const short = crewShort(docked) - 1
      const problem = short > 0 ? `the ship needs ${short} more crew aboard to sail` : undefined
      return { id: docked.id, ship: true, ...(problem ? { problem } : {}) }
    }
    // A ship is sailed, never rowed (`CONTEXT.md`: Sailing).
    const mine = world.vessels.filter((v) => v.kind !== 'ship' && vesselOfResident(v, selected))
    const aboard = mine.find((v) => v.id === selected.aboard)
    if (aboard) return { id: aboard.id }
    if (selected.aboard !== undefined) return undefined
    const beside = mine.find((v) => besideVessel(v, selected, world.map.size))
    if (!beside) return undefined
    const full =
      beside.rowerId !== undefined && (vesselRoom(beside) ?? PASSENGER_WEIGHT) < PASSENGER_WEIGHT
    return full ? { id: beside.id, problem: 'the boat is full' } : { id: beside.id }
  })()
  const stealableHere = onTile(world?.carriages.filter(isStrangers))
  // Another organization's boat, or nobody's, beside the picked resident of the realm's, to row
  // off (`CONTEXT.md`: Stealing a carriage or horse, its vessel part).
  const boatToSteal = ((): { id: string; problem: string | undefined } | undefined => {
    if (!selected || !world || selected.owner !== world.home.realmId) return undefined
    if (selected.aboard !== undefined) return undefined
    const size = world.map.size
    const v = world.vessels.find(
      (v) =>
        v.kind !== 'ship' && v.realmId !== world.home.realmId && besideVessel(v, selected, size),
    )
    if (!v) return undefined
    return { id: v.id, problem: rowOffProblem(selected.id, v.id, world.home.realmId) }
  })()
  // Another organization's horses for the picked resident (`CONTEXT.md`: Stealing a carriage or
  // horse): a free one to mount, and one to pull the realm's own carriage that has none of its own.
  const unhorsedHere = onTile(
    world?.carriages.filter((k) => k.realmId === world.home.realmId && !k.horseId),
  )
  const horseToHitch =
    world && selected && unhorsedHere
      ? horseToSteal(selected.id, unhorsedHere.id, world.home.realmId)
      : undefined
  const looseStrangers = onTile(
    world?.horses.filter(
      (h) => h.realmId !== world.home.realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
    ),
  )
  return {
    onTile,
    buildingHere,
    roadHere,
    carriageSiteHere,
    armyCarriages,
    isStrangers,
    ownCarriageHere,
    boatToRow,
    stealableHere,
    boatToSteal,
    unhorsedHere,
    horseToHitch,
    looseStrangers,
  }
}

/** What is on the picked resident's tile (`whatsHere`). */
export type WhatsHere = ReturnType<typeof whatsHere>

/** How many of the residents in sight work the building, if there is one. */
export function workersHere(residents: SeenResident[], building: Building | undefined): number {
  if (!building) return 0
  return residents.filter((r) => r.order?.kind === 'workAt' && r.order.buildingId === building.id)
    .length
}
/** The realms holding the building, as far as the Player sees its workers. */
export function heldBy(residents: SeenResident[], building: Building | undefined): string[] {
  return building ? holdersOf({ residents }, building) : []
}
