// The Creative section of a card (`CONTEXT.md`: Creative mode, ADR 0043): the creative actions
// an admin on a server started with `CREATIVE=1` can give by hand for the building or carriage
// the card shows. The server checks every action; this only picks which to offer.
import type { Building, BuildingKind, Carriage } from '@csp/shared-types'

/** Kinds of building that keep goods (`KEEPS_GOODS` on the server). */
const KEEPS_GOODS: readonly BuildingKind[] = ['storage', 'warehouse', 'stable', 'haven']

/** Something goods can be given to or taken from, as the section lists it. */
export interface CreativeHolder {
  id: string
  label: string
}

/** What the section offers for a card. */
export interface CreativeOffer {
  /** Where goods can be given or taken: the building's storage, the carriage on the tile. */
  holders: CreativeHolder[]
  /** What Finish now finishes, if anything: the building's id and the button's words. */
  finish?: { buildingId: string; label: string; title: string }
}

/** The creative actions for a card's building and the carriage on its tile, if any. */
export function creativeOffer(
  building: Pick<Building, 'id' | 'kind' | 'site'> | undefined,
  carriage: Pick<Carriage, 'id'> | undefined,
  buildingName: string,
): CreativeOffer {
  const holders: CreativeHolder[] = []
  if (building && !building.site && KEEPS_GOODS.includes(building.kind)) {
    holders.push({ id: building.id, label: `The ${buildingName}` })
  }
  if (carriage) holders.push({ id: carriage.id, label: 'The carriage' })
  const finish = !building
    ? undefined
    : building.site
      ? {
          buildingId: building.id,
          label: 'Finish now',
          title: 'Build the site now, and the rest of any road or wall line building on it',
        }
      : building.kind === 'trainingGround'
        ? {
            buildingId: building.id,
            label: 'Finish trainings now',
            title: 'Every trainee here trains as far as the teacher takes them, and stops',
          }
        : undefined
  return { holders, finish }
}

/** Whether a card has anything to offer in its Creative section. */
export function offersAnything(offer: CreativeOffer): boolean {
  return offer.holders.length > 0 || offer.finish !== undefined
}

/** The amount typed, if it is a whole number of units, at least one. */
export function creativeAmount(text: string): number | undefined {
  const n = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : undefined
}
