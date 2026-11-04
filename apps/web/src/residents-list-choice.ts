import {
  ADULT_AGE,
  STAT_NAMES,
  WEAPONS,
  ageInYears,
  bestWeapon,
  isArmed,
  statValue,
  stockWeight,
  type Resident,
  type SkillName,
  type Weapon,
} from '@csp/shared'
import { GOOD_LABELS } from './goods-grid.js'
import { SKILL_LABELS, STAT_LABELS } from './Residents.js'
import { gearLine, learnedSkills, type ListedResident } from './residents-list-view.js'
import { isIdle, type ResidentGroup } from './residents-view.js'

/**
 * What the Player chose to see of the full Residents list (`CONTEXT.md`: Residents list): the
 * search, the filters and the sort. Only the UI: it is kept per browser, never in the world.
 */

/** The columns of the full list, in the order they show; it can be sorted by any of them. */
export const LIST_COLUMNS = [
  'name',
  'age',
  'city',
  ...STAT_NAMES,
  'skills',
  'gear',
  'carrying',
  'hunger',
  'health',
  'doing',
] as const
export type ListColumn = (typeof LIST_COLUMNS)[number]

const WEAPON_FILTERS = ['any', 'armed', 'unarmed', ...WEAPONS] as const
export type WeaponFilter = (typeof WEAPON_FILTERS)[number]
const DOING_FILTERS = ['any', 'idle', 'busy'] as const
export type DoingFilter = (typeof DOING_FILTERS)[number]
const AGE_FILTERS = ['any', 'child', 'adult'] as const
export type AgeFilter = (typeof AGE_FILTERS)[number]
const SKILL_FILTERS = ['any', ...(Object.keys(SKILL_LABELS) as SkillName[])] as const
export type SkillFilter = (typeof SKILL_FILTERS)[number]

export interface ResidentsChoice {
  /** Part of a name, in any case; empty finds everyone. */
  search: string
  /** Everyone, those armed, those not, or those who fight with this weapon (`bestWeapon`). */
  weapons: WeaponFilter
  doing: DoingFilter
  age: AgeFilter
  /** The key of a group of the list (`ResidentGroup`), or empty for all of them. */
  city: string
  /** Everyone, or those who learned this skill as far as the Skills column shows it. */
  skill: SkillFilter
  sort: ListColumn
  /** Against the column's first order: highest or Z first, or the last group first. */
  descending: boolean
}

/** Columns of words, the first of them A first; all others are numbers and start highest first. */
const WORD_COLUMNS: readonly ListColumn[] = ['name', 'city', 'gear', 'doing']

/** The direction a column is sorted in when it is first chosen. */
const startsDescending = (column: ListColumn) => !WORD_COLUMNS.includes(column)

/** The list as it opens at first: everyone, in the Residents drawer's order. */
export const DEFAULT_CHOICE: ResidentsChoice = {
  search: '',
  weapons: 'any',
  doing: 'any',
  age: 'any',
  city: '',
  skill: 'any',
  sort: 'city',
  descending: false,
}

/** The options of each filter, as the list's selects name them. */
export const WEAPON_OPTIONS: readonly { value: WeaponFilter; label: string }[] = [
  { value: 'any', label: 'Anyone' },
  { value: 'armed', label: 'Has weapons' },
  { value: 'unarmed', label: 'No weapons' },
  ...WEAPONS.map((value) => ({ value, label: GOOD_LABELS[value] })),
]
export const DOING_OPTIONS: readonly { value: DoingFilter; label: string }[] = [
  { value: 'any', label: 'Anyone' },
  { value: 'idle', label: 'Idle' },
  { value: 'busy', label: 'Busy' },
]
export const AGE_OPTIONS: readonly { value: AgeFilter; label: string }[] = [
  { value: 'any', label: 'Anyone' },
  { value: 'child', label: 'Children' },
  { value: 'adult', label: 'Grown up' },
]
export const SKILL_OPTIONS: readonly { value: SkillFilter; label: string }[] = [
  { value: 'any', label: 'Anyone' },
  ...(Object.keys(SKILL_LABELS) as SkillName[]).map((value) => ({
    value,
    label: SKILL_LABELS[value],
  })),
]

/** A column's whole name, where the table's heading may shorten it. */
export const COLUMN_LABELS: Record<ListColumn, string> = {
  name: 'Name',
  age: 'Age',
  city: 'City',
  ...STAT_LABELS,
  skills: 'Skills',
  gear: 'Gear',
  carrying: 'Carrying',
  hunger: 'Hunger',
  health: 'Health',
  doing: 'Doing',
}

/** The order a column is sorted in, in words. */
export function directionLabel(column: ListColumn, descending: boolean): string {
  if (column === 'city') return descending ? 'Home city last' : 'Home city first'
  if (WORD_COLUMNS.includes(column)) return descending ? 'Z to A' : 'A to Z'
  return descending ? 'Highest first' : 'Lowest first'
}

/** Sorted by `column`: choosing it again turns the order round. */
export function sortBy(choice: ResidentsChoice, column: ListColumn): ResidentsChoice {
  return choice.sort === column
    ? { ...choice, descending: !choice.descending }
    : { ...choice, sort: column, descending: startsDescending(column) }
}

/** The search and the filters off; the sort stays. */
export function clearFilters(choice: ResidentsChoice): ResidentsChoice {
  return { ...DEFAULT_CHOICE, sort: choice.sort, descending: choice.descending }
}

/** How many of the filters are on, the search apart. */
export function filtersOn(choice: ResidentsChoice): number {
  const { weapons, doing, age, city, skill } = DEFAULT_CHOICE
  return [
    choice.weapons !== weapons,
    choice.doing !== doing,
    choice.age !== age,
    choice.city !== city,
    choice.skill !== skill,
  ].filter(Boolean).length
}

/**
 * The choice as far as it fits the list now: a city with nobody of the Player's left in it, or one
 * of another realm, can't be picked in the list, so it counts as all of them. It stays saved, and
 * counts again when someone lives there.
 */
export function fittingChoice(
  choice: ResidentsChoice,
  groups: readonly Pick<ResidentGroup<unknown>, 'key'>[],
): ResidentsChoice {
  return choice.city === '' || groups.some((g) => g.key === choice.city)
    ? choice
    : { ...choice, city: '' }
}

function fitsWeapons(r: Resident, weapons: WeaponFilter): boolean {
  if (weapons === 'any') return true
  if (weapons === 'armed') return isArmed(r)
  if (weapons === 'unarmed') return !isArmed(r)
  return bestWeapon(r) === (weapons satisfies Weapon)
}

/** Those of the listed residents the search and the filters leave, in the same order. */
export function filterResidents(
  listed: readonly ListedResident<Resident>[],
  choice: ResidentsChoice,
  tick: number,
): ListedResident<Resident>[] {
  const search = choice.search.trim().toLocaleLowerCase()
  return listed.filter(({ resident: r, group }) => {
    if (search && !r.name.toLocaleLowerCase().includes(search)) return false
    if (!fitsWeapons(r, choice.weapons)) return false
    if (choice.doing !== 'any' && isIdle(r) !== (choice.doing === 'idle')) return false
    if (choice.age !== 'any' && ageInYears(r, tick) < ADULT_AGE !== (choice.age === 'child'))
      return false
    if (choice.city && group !== choice.city) return false
    if (choice.skill !== 'any' && !learnedSkills(r).some((s) => s.skill === choice.skill))
      return false
    return true
  })
}

/** What a resident is sorted by in a column; undefined when they have nothing to show there. */
function sortValue(
  r: Resident,
  column: Exclude<ListColumn, 'city'>,
  tick: number,
  doing: (r: Resident) => string,
): number | string | undefined {
  switch (column) {
    case 'name':
      return r.name
    case 'age':
      return ageInYears(r, tick)
    case 'skills':
      return learnedSkills(r)[0]?.level
    case 'gear':
      return gearLine(r)
    case 'carrying':
      return Object.values(r.carried).some((n) => (n ?? 0) > 0) ? stockWeight(r.carried) : undefined
    case 'hunger':
      return r.hunger
    case 'health':
      return r.health
    case 'doing':
      return doing(r)
    default:
      return statValue(r, column, tick)
  }
}

const missing = (v: number | string | undefined) =>
  v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))

const words = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The residents sorted by the chosen column. Whoever has nothing in it comes last in either
 * direction, and residents of the same value stay in the order they came in, so rows don't swap
 * back and forth. City sorts by the groups' order, the Residents drawer's: the home city first.
 * `doing` is asked only when sorted by Doing, as it costs the most.
 */
export function sortResidents(
  listed: readonly ListedResident<Resident>[],
  { sort, descending }: Pick<ResidentsChoice, 'sort' | 'descending'>,
  { tick, doing }: { tick: number; doing: (r: Resident) => string },
): ListedResident<Resident>[] {
  const groupAt = new Map<string, number>()
  if (sort === 'city') {
    for (const { group } of listed) if (!groupAt.has(group)) groupAt.set(group, groupAt.size)
  }
  const keyed = listed.map((l) => ({
    l,
    value: sort === 'city' ? groupAt.get(l.group) : sortValue(l.resident, sort, tick, doing),
  }))
  keyed.sort((a, b) => {
    if (missing(a.value) || missing(b.value)) {
      return Number(missing(a.value)) - Number(missing(b.value))
    }
    const order =
      typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : words.compare(String(a.value), String(b.value))
    return descending ? -order : order
  })
  return keyed.map((k) => k.l)
}

/** Where the browser keeps the choice. */
export const CHOICE_KEY = 'csp.residents-list'

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/**
 * The choice read back from storage. Whatever it holds that is no use, a filter that is gone or
 * not the right kind of value, falls back to the default for just that part; a sort that is no use
 * takes its direction along.
 */
export function parseChoice(text: string | null): ResidentsChoice {
  if (!text) return DEFAULT_CHOICE
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return DEFAULT_CHOICE
  }
  if (!raw || typeof raw !== 'object') return DEFAULT_CHOICE
  const saved = raw as Record<string, unknown>
  const sort = oneOf(saved.sort, LIST_COLUMNS, DEFAULT_CHOICE.sort)
  return {
    search: typeof saved.search === 'string' ? saved.search : DEFAULT_CHOICE.search,
    weapons: oneOf(saved.weapons, WEAPON_FILTERS, DEFAULT_CHOICE.weapons),
    doing: oneOf(saved.doing, DOING_FILTERS, DEFAULT_CHOICE.doing),
    age: oneOf(saved.age, AGE_FILTERS, DEFAULT_CHOICE.age),
    city: typeof saved.city === 'string' ? saved.city : DEFAULT_CHOICE.city,
    skill: oneOf(saved.skill, SKILL_FILTERS, DEFAULT_CHOICE.skill),
    sort,
    descending:
      saved.sort === sort && typeof saved.descending === 'boolean'
        ? saved.descending
        : DEFAULT_CHOICE.descending,
  }
}

/** The choice this browser remembers; the default without storage. */
export function loadChoice(storage: Pick<Storage, 'getItem'> | undefined): ResidentsChoice {
  try {
    return parseChoice(storage?.getItem(CHOICE_KEY) ?? null)
  } catch {
    return DEFAULT_CHOICE
  }
}

/** Remembers the choice in this browser; without storage it lasts until the list closes. */
export function storeChoice(
  storage: Pick<Storage, 'setItem'> | undefined,
  choice: ResidentsChoice,
) {
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(choice))
  } catch {
    // Without storage it just isn't remembered.
  }
}
