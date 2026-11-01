import {
  CARRYING_A_CHILD,
  relocateProblem,
  relocateRoom,
  type Building,
  type City,
  type Resident,
} from '@csp/shared'

/**
 * What the Player knows that relocating needs (`CONTEXT.md`: Relocate): the cities and buildings
 * in sight and remembered out of it, and the residents in sight, their own all among them.
 */
export interface RelocateSeen {
  cities: readonly City[]
  buildings: readonly Building[]
  residents: readonly Pick<Resident, 'id' | 'cityId' | 'order'>[]
}

/** A city of the realm a resident can be told to relocate to, as the card's picker lists it. */
export interface RelocateChoice {
  id: string
  name: string
  /** Its free housing, less the residents already relocating there (`relocateRoom`). */
  room: number
  /** Why the resident can't be told to relocate there now, if they can't (`relocateProblem`). */
  problem?: string
}

/**
 * The cities in sight and those remembered, each once: in sight wins, as it is newer
 * (`CONTEXT.md`: Last seen). Out of sight, the Player's own city is known as last seen.
 */
export function knownOf<T extends { id: string }>(inSight: readonly T[], remembered: readonly T[]) {
  const seen = new Set(inSight.map((x) => x.id))
  return [...inSight, ...remembered.filter((x) => !seen.has(x.id))]
}

/**
 * The realm's other cities a resident can be told to relocate to, by name, each with its free
 * housing counting those on their way and why the order can't go there, if it can't: the same
 * check the server runs (`relocateProblem`) on what the Player knows. The server checks again.
 */
export function relocateChoices(
  seen: RelocateSeen,
  realmId: string,
  r: Pick<Resident, 'id' | 'name' | 'owner' | 'cityId' | 'carrying'>,
): RelocateChoice[] {
  return seen.cities
    .filter((c) => c.realmId === realmId && c.id !== r.cityId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const problem = relocateProblem(seen, realmId, [r], c.id)
      return {
        id: c.id,
        name: c.name,
        room: Math.max(0, relocateRoom(seen, c, new Set([r.id]))),
        ...(problem ? { problem } : {}),
      }
    })
}

/**
 * Why the card's Relocate action can't be used at all for a resident, if it can't: they carry a
 * child (`CONTEXT.md`: Carrying), or the realm has no other city to go to.
 */
export function relocateActionProblem(
  r: Pick<Resident, 'carrying'>,
  choices: readonly RelocateChoice[],
): string | undefined {
  if (r.carrying) return CARRYING_A_CHILD
  if (choices.length === 0) return 'your realm has no other city'
  return undefined
}
