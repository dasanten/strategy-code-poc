import { HORSE_HUNGRY_SHARE, MAX_HEALTH, MAX_HUNGER, TICKS_PER_GAME_DAY } from '@csp/balance'
import { drivenCarriageId } from './shared/carriages.js'
import { horseAgeInYears } from './shared/stats.js'
import { isAt } from './shared/footprint.js'
import { isDown } from './shared/world.js'
import { timeLeft } from './shared/estimates.js'
import type { Building, Carriage, City, Horse, Resident, SeenHorse } from '@csp/shared-types'
import { nameLabels } from './name-labels.js'

/** What a horse's card and row say can be done for it (`CONTEXT.md`: Feeding a horse). */
export const FEED_HORSE_HINT = 'a resident with Food can Feed it'

/**
 * A Down horse in words (`CONTEXT.md`: Down, Reviving): "Down from hunger: about 23 h left",
 * the time left when it is seen (`downUntil`) and `tick` is given, and that it can be Fed.
 */
export function horseDownLine(h: { downUntil?: number }, tick?: number): string {
  const down =
    h.downUntil === undefined || tick === undefined
      ? 'Down from hunger'
      : `Down from hunger: ${timeLeft(h.downUntil - tick)}`
  return `${down} · ${FEED_HORSE_HINT}`
}

/**
 * What a horse needs, for its row where it says so first: that it is Down (`horseDownLine`), or
 * hungry where the Player knows how it fares, and that it can be Fed. Undefined for a fed one.
 */
export function horseNeed(
  h: { downUntil?: number; down?: true; hunger?: number },
  tick?: number,
): string | undefined {
  if (isDown(h)) return horseDownLine(h, tick)
  if (h.hunger === undefined || h.hunger >= HORSE_HUNGRY_SHARE * MAX_HUNGER) return undefined
  return `${h.hunger <= 0 ? 'Starving' : 'Hungry'} · ${FEED_HORSE_HINT}`
}

/** One horse of the Horses drawer and where it stands, in words. */
export interface HorseRow<H> {
  horse: H
  /**
   * "Pulling the carriage Ann drives", "Ridden by Ann", "In the stable", "Loose at 12, 40"; for
   * a Down or hungry horse first that it is, and that it can be Fed (`horseNeed`).
   */
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
 * don't jump. With `tick`, riders and drivers of one name are told apart (`nameLabels`). A Down or
 * hungry horse's place says so first (`horseNeed`).
 */
export function groupHorses<
  H extends Pick<Horse, 'id' | 'x' | 'y' | 'downUntil'> & { down?: true; hunger?: number },
>(
  horses: readonly H[],
  buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'cityId'>[],
  carriages: readonly Pick<Carriage, 'id' | 'horseId'>[],
  residents: readonly Pick<Resident, 'id' | 'name' | 'riding' | 'order' | 'bornAt' | 'cityId'>[],
  cities: readonly Pick<City, 'id' | 'name'>[] = [],
  tick?: number,
): HorseGroup<H>[] {
  const labels =
    tick === undefined
      ? undefined
      : nameLabels(
          residents.filter((r) => r.riding !== undefined || drivenCarriageId(r) !== undefined),
          tick,
          cities,
        )
  const nameOf = (r: (typeof residents)[number]) => labels?.get(r.id) ?? r.name
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
        ? `Pulling the carriage ${nameOf(driver)} drives`
        : 'Hitched to a carriage nobody drives'
      : undefined
    const ridden = rider ? `Ridden by ${nameOf(rider)}` : undefined
    const stable = stables.find((b) => isAt(h, b))
    const need = horseNeed(h, tick)
    const row = (place: string) => ({ horse: h, place: need ? `${need} · ${place}` : place })
    if (stable) {
      const also = pulling ?? ridden
      group(stable.id).rows.push(row(also ? `In the stable · ${also}` : 'In the stable'))
    } else if (pulling) group('hitched').rows.push(row(pulling))
    else if (ridden) group('ridden').rows.push(row(ridden))
    else group('loose').rows.push(row(`Loose at ${Math.floor(h.x)}, ${Math.floor(h.y)}`))
  }
  return groups.filter((g) => g.rows.length > 0)
}

/** A horse's row in the Horses drawer on a phone (`horseLines`). */
export interface HorseLines {
  /** First line: its name, age and Speed/Strength/Endurance. */
  name: string
  age: string
  stats: string
  /** Second line: where it stands, with health and hunger meters at its end. */
  place: string
  /** Health and how fed it is, 0 to 1, or undefined where the Player doesn't know. */
  health?: number
  fed?: number
}

/**
 * A horse's row in the Horses drawer on a phone (ADR 0012), laid out like a resident's: two lines
 * in place of the table's columns, "Zephyr · 3 years · 12/8/10" and where it stands with its
 * health and hunger meters at the end.
 */
export function horseLines({ horse: h, place }: HorseRow<SeenHorse>, tick: number): HorseLines {
  const years = Math.floor(horseAgeInYears(h, tick))
  const days = Math.max(0, Math.floor((tick - h.bornAt) / TICKS_PER_GAME_DAY))
  const share = (n: number | undefined, max: number) =>
    n === undefined ? undefined : Math.max(0, Math.min(1, n / max))
  return {
    name: h.name,
    age:
      years >= 1
        ? `${years} ${years === 1 ? 'year' : 'years'}`
        : `${days} game ${days === 1 ? 'day' : 'days'}`,
    stats: `${h.stats.speed}/${h.stats.strength}/${h.stats.endurance}`,
    place,
    health: share(h.health, MAX_HEALTH),
    fed: share(h.hunger, MAX_HUNGER),
  }
}
