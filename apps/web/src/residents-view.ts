import type { City, Diplomacy, Resident } from '@csp/shared'

/** One heading of the Residents drawer and the residents under it. */
export interface ResidentGroup<R> {
  /** A city's id, or `hired`, `army` or `homeless`. */
  key: string
  label: string
  residents: R[]
}

/**
 * The residents the Player commands, grouped for the Residents drawer: by the city they live in
 * (`CONTEXT.md`: Resident), the home city first and the Player's other cities by name, then the
 * mercenaries they hired (`CONTEXT.md`: Mercenary contract), what was handed over to their
 * alliance army (`CONTEXT.md`: Alliance army) and the homeless. Empty groups are left out. The
 * Leader comes first in their group; the rest keep the order they came in, so rows don't jump
 * around as residents change what they do.
 */
export function groupResidents<R extends Pick<Resident, 'id' | 'cityId'>>(
  residents: readonly R[],
  {
    cities,
    realmId,
    homeCityId,
    leaderId,
    diplomacy,
  }: {
    cities: readonly Pick<City, 'id' | 'name' | 'realmId'>[]
    realmId: string
    homeCityId: string | null
    leaderId: string
    diplomacy: Pick<Diplomacy, 'alliance' | 'contracts'>
  },
): ResidentGroup<R>[] {
  const own = cities
    .filter((c) => c.realmId === realmId)
    .sort((a, b) =>
      a.id === homeCityId ? -1 : b.id === homeCityId ? 1 : a.name.localeCompare(b.name),
    )
  const army = new Set(diplomacy.alliance?.army.map((p) => p.id))
  const hired = new Set(
    diplomacy.contracts
      .filter((c) => c.startedAt !== null && c.hirer.realmId === realmId)
      .flatMap((c) => c.residents.map((r) => r.id)),
  )
  const groupOf = (r: R): string => {
    if (army.has(r.id)) return 'army'
    if (hired.has(r.id)) return 'hired'
    return own.some((c) => c.id === r.cityId) ? r.cityId! : 'homeless'
  }
  const groups: ResidentGroup<R>[] = [
    ...own.map((c) => ({ key: c.id, label: c.name, residents: [] })),
    { key: 'hired', label: 'Hired', residents: [] },
    { key: 'army', label: 'Alliance army', residents: [] },
    { key: 'homeless', label: 'Homeless', residents: [] },
  ]
  for (const r of residents) {
    const group = groups.find((g) => g.key === groupOf(r))!
    if (r.id === leaderId) group.residents.unshift(r)
    else group.residents.push(r)
  }
  return groups.filter((g) => g.residents.length > 0)
}

/**
 * Carried weight over carry capacity (`CONTEXT.md`: Carry capacity), as the resident list and the
 * Goods section show it: "12 / 30 kg", each to one decimal (coins weigh little).
 */
export function carryLine(carried: number, capacity: number): string {
  const kg = (weight: number) => Math.round(weight * 10) / 10
  return `${kg(carried)} / ${kg(capacity)} kg`
}

/**
 * Which sections of the resident card are open: the panel an action opened (Goods, Build, …) and
 * the Stats and skills. They stay open when the Player selects another unit, until closed; a unit
 * without that action shows no panel.
 */
export interface CardSections<A extends string = string> {
  panel?: A
  stats: boolean
}

/** How many residents a group card lists before saying how many more there are. */
export const GROUP_LIST_MAX = 8

/**
 * The group card's head and list, for several residents picked at once: how many, their names
 * (the first few, then how many more), and the residents it lists one per row.
 */
export function groupCard<R extends Pick<Resident, 'name'>>(
  residents: readonly R[],
): { title: string; names: string; rows: R[]; more: number } {
  const names = residents.slice(0, 3).map((r) => r.name)
  const rest = residents.length - names.length
  const last = rest > 0 ? `${rest} more` : names.pop()
  return {
    title: `${residents.length} residents`,
    names: names.length > 0 ? `${names.join(', ')} and ${last}` : (last ?? ''),
    rows: residents.slice(0, GROUP_LIST_MAX),
    more: Math.max(0, residents.length - GROUP_LIST_MAX),
  }
}
