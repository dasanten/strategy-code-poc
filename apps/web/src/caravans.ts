import type { Carriage, Resident, SeenCaravan } from '@csp/shared'

/** What of the Trade Org's caravans is in sight (`CONTEXT.md`: Caravan): their carriages and crew, by id. */
export interface CaravanParts {
  carriages: Set<string>
  crew: Set<string>
}

/** The carriages and crew of the caravans in sight. */
export function caravanParts(caravans: readonly SeenCaravan[]): CaravanParts {
  return {
    carriages: new Set(caravans.map((c) => c.carriageId)),
    crew: new Set(caravans.flatMap((c) => [c.driverId, ...c.escortIds])),
  }
}

/** Whether a caravan's carriage or one of its crew stands on tile (x, y), for the map's hover line. */
export function caravanAt(
  parts: CaravanParts,
  world: { residents: readonly Resident[]; carriages: readonly Carriage[] },
  x: number,
  y: number,
): boolean {
  return (
    world.carriages.some((k) => k.x === x && k.y === y && parts.carriages.has(k.id)) ||
    world.residents.some((r) => r.x === x && r.y === y && parts.crew.has(r.id))
  )
}
