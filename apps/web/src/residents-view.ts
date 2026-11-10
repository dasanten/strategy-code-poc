import { MAX_HUNGER, PAIRING_WAIT_TICKS, TICKS_PER_GAME_DAY } from '@csp/balance'
import { ageInYears } from './shared/stats.js'
import type { City, Diplomacy, Good, Resident, Stock } from '@csp/shared-types'

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

/** A resident's row in the Residents drawer on a phone (`residentLines`). */
export interface ResidentLines {
  /** First line: their name, the Leader mark after it, and their age. */
  name: string
  leader: boolean
  age: string
  /** Second line: what they are doing, with a hunger meter at its end. */
  doing: string
  /** How fed they are, 0 to 1, for the meter. */
  fed: number
}

/** An age in whole years, in words: "34 years". */
export function yearsLine(years: number): string {
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

/**
 * A resident's row in the Residents drawer on a phone (ADR 0012): two lines in place of the
 * table's columns, "Edda · Leader · 34 years" and their Doing line (`doingLine`) with the hunger
 * meter at its end.
 */
export function residentLines(
  r: Pick<Resident, 'id' | 'name' | 'bornAt' | 'hunger'>,
  { leaderId, tick, doing }: { leaderId: string; tick: number; doing: string },
): ResidentLines {
  return {
    name: r.name,
    leader: r.id === leaderId,
    age: yearsLine(Math.floor(ageInYears(r, tick))),
    doing,
    fed: Math.max(0, Math.min(1, r.hunger / MAX_HUNGER)),
  }
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
 * The resident card's carried goods, short, for its header: "Carrying 4 Wood, 2 Food" with the
 * most first, at most `max` kinds and then how many more, or "Carrying nothing".
 */
export function carriedShort(
  carried: Stock | undefined,
  labels: Record<Good, string>,
  max = 3,
): string {
  const goods = goodsShort(carried, labels, max)
  return goods ? `Carrying ${goods}` : 'Carrying nothing'
}

/**
 * Goods, short: "4 Wood, 2 Food" with the most first, at most `max` kinds and then how many more;
 * undefined with none.
 */
export function goodsShort(
  carried: Stock | undefined,
  labels: Record<Good, string>,
  max: number,
): string | undefined {
  const goods = (Object.entries(carried ?? {}) as [Good, number | undefined][])
    .filter((e): e is [Good, number] => (e[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
  if (goods.length === 0) return undefined
  const shown = goods.slice(0, max).map(([g, n]) => `${Math.floor(n)} ${labels[g]}`)
  const more = goods.length - shown.length
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/** The tabs under the resident card's header (ADR 0012), in the order they show. */
export const CARD_TABS = ['orders', 'queue', 'stats', 'script'] as const
export type CardTab = (typeof CARD_TABS)[number]

/** Each tab's label. */
export const CARD_TAB_LABELS: Record<CardTab, string> = {
  orders: 'Orders',
  queue: 'Queue',
  stats: 'Stats',
  script: 'Script',
}

/** The tabs under the group card's header (ADR 0012), in the order they show. */
export const GROUP_TABS = ['orders', 'queue', 'members', 'script'] as const
export type GroupTab = (typeof GROUP_TABS)[number]

/** The tabs under the army card's header (ADR 0012), in the order they show. */
export const ARMY_TABS = ['orders', 'members', 'supply', 'script'] as const
export type ArmyTab = (typeof ARMY_TABS)[number]

/** Every card tab's label. */
export const TAB_LABELS: Record<CardTab | GroupTab | ArmyTab, string> = {
  ...CARD_TAB_LABELS,
  members: 'Members',
  supply: 'Supply',
}

/** Where the browser keeps each card's last open tab. */
const TAB_KEYS = { resident: 'csp.cardTab', group: 'csp.groupTab', army: 'csp.armyTab' } as const
export type CardKind = keyof typeof TAB_KEYS

/** The tab a card of that kind opens on: the one remembered in this browser, else the first. */
export function rememberedTabOf<T extends string>(
  kind: CardKind,
  tabs: readonly [T, ...T[]],
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): T {
  try {
    const tab = storage().getItem(TAB_KEYS[kind])
    return tabs.find((t) => t === tab) ?? tabs[0]
  } catch {
    // Storage can be off (a private window); the card then just opens on its first tab.
    return tabs[0]
  }
}

/** Remembers a card's open tab in this browser, if it lets us. */
export function rememberTabOf(
  kind: CardKind,
  tab: string,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(TAB_KEYS[kind], tab)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

/** The tab a resident card opens on: the one remembered in this browser, else Orders. */
export function rememberedTab(
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): CardTab {
  return rememberedTabOf('resident', CARD_TABS, storage)
}

/** Remembers the resident card's open tab in this browser, if it lets us. */
export function rememberTab(
  tab: CardTab,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  rememberTabOf('resident', tab, storage)
}

/**
 * What the army card says about its supply wagons (`CONTEXT.md`: Supply line): one line per
 * driver of the Player's whose carriage goes after the army, with the Food its members may take.
 */
export function supplyLines(
  drivers: { name: string; carriageId: string; haul: boolean }[],
  spareFood: (carriageId: string) => number,
): string[] {
  return drivers.map(
    (d) =>
      `${d.name} · ${d.haul ? 'haul route' : 'following'} · ${Math.floor(spareFood(d.carriageId))} Food to take`,
  )
}

/**
 * What the resident card shows: the open tab and the panel an order opened (Goods, Build, …).
 * They stay as they are when the Player selects another unit; a unit without that order shows no
 * panel.
 */
export interface CardSections<A extends string = string> {
  panel?: A
  tab: CardTab
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

/** Whether a resident is idle: with neither an order nor a script. */
export function isIdle(r: Pick<Resident, 'order' | 'script'>): boolean {
  return !r.order && !r.script
}

/** How many of the residents are busy (with an order or a script) and how many idle. */
export function busyAndIdle(residents: readonly Pick<Resident, 'order' | 'script'>[]): {
  busy: number
  idle: number
} {
  const idle = residents.filter(isIdle).length
  return { busy: residents.length - idle, idle }
}

/** The Residents drawer's head: "8 residents · 7 busy · 1 idle". */
export function residentsCount(residents: readonly Pick<Resident, 'order' | 'script'>[]): string {
  if (residents.length === 0) return 'No residents'
  const { busy, idle } = busyAndIdle(residents)
  const all = residents.length === 1 ? '1 resident' : `${residents.length} residents`
  return `${all} · ${busy} busy · ${idle} idle`
}

/**
 * What the group card's Script tab says the residents run: one line per script, most run first,
 * then how many run none. `scripts` holds each resident's script name, undefined for none.
 */
export function scriptsRun(scripts: readonly (string | undefined)[]): string[] {
  const counts = new Map<string, number>()
  let none = 0
  for (const s of scripts) {
    if (s === undefined) none++
    else counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  const lines = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${n} ${n === 1 ? 'runs' : 'run'} ${name}`)
  if (none > 0) lines.push(`${none} ${none === 1 ? 'runs' : 'run'} no script`)
  return lines
}

/**
 * Game days until a pair's wait is over and one partner can start carrying (`CONTEXT.md`:
 * Pairing): the pairing wait counted from when they paired, never below 0.
 */
export function pairingDaysLeft(since: number, tick: number): number {
  return Math.max(0, Math.ceil((since + PAIRING_WAIT_TICKS - tick) / TICKS_PER_GAME_DAY))
}

/**
 * A stat on the Stats tab (`CONTEXT.md`: Trained bonus): "10 + 2.3 (5)", base, trained bonus and
 * its cap. Training adds a little each tick, so the bonus shows to a tenth, rounded down: it reads
 * as the cap only once it is there.
 */
export function statLine(base: number, trained: number, cap: number): string {
  return `${base} + ${Math.floor(trained * 10 + 1e-9) / 10} (${cap})`
}
