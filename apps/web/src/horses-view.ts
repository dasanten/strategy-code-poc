import {
  drivenCarriageId,
  isAt,
  type Building,
  type Carriage,
  type City,
  type Horse,
  type Resident,
} from '@csp/shared'

/** One horse of the Horses drawer and where it stands, in words. */
export interface HorseRow<H> {
  horse: H
  /** "Pulling the carriage Ann drives", "Ridden by Ann", "In the stable", "Loose at 12, 40". */
  place: string
}

/** One heading of the Horses drawer and the horses under it. */
export interface HorseGroup<H> {
  /** A stable's id, or `hitched`, `ridden` or `loose`. */
  key: string
  label: string
  rows: HorseRow<H>[]
}

/**
 * The realm's horses grouped for the Horses drawer (`CONTEXT.md`: Horses drawer) by where they
 * stand: a horse on a stable's footprint is that stable's, hitched or ridden or not; else one
 * hitched to a carriage (`carriage.horseId`), one somebody rides, and the rest loose. Stables come
 * first, by name ("Stable, Oakford", with its corner when the city has more than one), then
 * Hitched, Ridden and Loose. Empty groups are left out; horses keep the order they came in, so rows
 * don't jump.
 */
export function groupHorses<H extends Pick<Horse, 'id' | 'x' | 'y'>>(
  horses: readonly H[],
  buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'cityId'>[],
  carriages: readonly Pick<Carriage, 'id' | 'horseId'>[],
  residents: readonly Pick<Resident, 'id' | 'name' | 'riding' | 'order'>[],
  cities: readonly Pick<City, 'id' | 'name'>[] = [],
): HorseGroup<H>[] {
  const stables = buildings.filter((b) => b.kind === 'stable')
  const cityName = (b: (typeof stables)[number]) => cities.find((c) => c.id === b.cityId)?.name
  const stableLabel = (b: (typeof stables)[number]) => {
    const city = cityName(b)
    const label = city ? `Stable, ${city}` : 'Stable'
    const shared = stables.filter((o) => cityName(o) === city).length > 1
    return shared ? `${label} (${b.x}, ${b.y})` : label
  }
  const stableGroups: HorseGroup<H>[] = stables
    .map((b) => ({ key: b.id, label: stableLabel(b), rows: [] }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const groups: HorseGroup<H>[] = [
    ...stableGroups,
    { key: 'hitched', label: 'Hitched', rows: [] },
    { key: 'ridden', label: 'Ridden', rows: [] },
    { key: 'loose', label: 'Loose', rows: [] },
  ]
  const group = (key: string) => groups.find((g) => g.key === key)!

  for (const h of horses) {
    const carriage = carriages.find((k) => k.horseId === h.id)
    const driver = carriage && residents.find((r) => drivenCarriageId(r) === carriage.id)
    const rider = residents.find((r) => r.riding === h.id)
    const pulling = carriage
      ? driver
        ? `Pulling the carriage ${driver.name} drives`
        : 'Hitched to a carriage nobody drives'
      : undefined
    const ridden = rider ? `Ridden by ${rider.name}` : undefined
    const stable = stables.find((b) => isAt(h, b))
    if (stable) {
      const also = pulling ?? ridden
      group(stable.id).rows.push({
        horse: h,
        place: also ? `In the stable · ${also}` : 'In the stable',
      })
    } else if (pulling) group('hitched').rows.push({ horse: h, place: pulling })
    else if (ridden) group('ridden').rows.push({ horse: h, place: ridden })
    else {
      group('loose').rows.push({
        horse: h,
        place: `Loose at ${Math.floor(h.x)}, ${Math.floor(h.y)}`,
      })
    }
  }
  return groups.filter((g) => g.rows.length > 0)
}
