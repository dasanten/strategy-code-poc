import { ageInYears, type City, type Resident } from '@csp/shared'

type Named = Pick<Resident, 'id' | 'name' | 'bornAt' | 'cityId'>

/**
 * What a list of residents calls each of them (`CONTEXT.md`: Game-given names): their name, and
 * for those whose name another in the list shares, their age, and their city too when those live
 * in more than one: "Edda (24)", "Edda (31, Ashford)". Names from before names were unique can
 * repeat, and so can the Player's renames.
 */
export function nameLabels(
  residents: readonly Named[],
  tick: number,
  cities: readonly Pick<City, 'id' | 'name'>[] = [],
): Map<string, string> {
  const byName = new Map<string, Named[]>()
  for (const r of residents) byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  const labels = new Map<string, string>()
  for (const [name, same] of byName) {
    const apart = new Set(same.map((r) => r.cityId)).size > 1
    for (const r of same) {
      if (same.length === 1) {
        labels.set(r.id, name)
        continue
      }
      const age = Math.floor(ageInYears(r, tick))
      const city = r.cityId === null ? 'homeless' : cities.find((c) => c.id === r.cityId)?.name
      labels.set(r.id, apart && city ? `${name} (${age}, ${city})` : `${name} (${age})`)
    }
  }
  return labels
}

/** The residents of a list with `nameLabels`' names, for lists that show `name`. */
export function labelled<R extends Named>(
  residents: readonly R[],
  tick: number,
  cities: readonly Pick<City, 'id' | 'name'>[] = [],
): R[] {
  const labels = nameLabels(residents, tick, cities)
  return residents.map((r) => {
    const name = labels.get(r.id)!
    return name === r.name ? r : { ...r, name }
  })
}
