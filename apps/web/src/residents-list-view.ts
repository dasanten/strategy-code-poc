import {
  MAX_HEALTH,
  MAX_HUNGER,
  PROTECTION,
  STAT_NAMES,
  ageInYears,
  bestWeapon,
  carryCapacity,
  statValue,
  stockWeight,
  type Resident,
  type SkillName,
  type StatName,
} from '@csp/shared'
import { GOOD_LABELS } from './goods-grid.js'
import { SKILL_LABELS } from './Residents.js'
import { carryLine, goodsShort, type ResidentGroup } from './residents-view.js'

/** A row's height in the full Residents list, in pixels: rows are this tall so only those in view are drawn. */
export const FULL_ROW_HEIGHT = 44
/** A row's height in the full Residents list on a phone, where each is a compact card. */
export const FULL_CARD_HEIGHT = 130
/** Rows drawn beyond each edge of the view, so a quick scroll doesn't show a gap. */
export const ROW_OVERSCAN = 8

/** One resident in the full list, with the city heading they stand under in the Residents drawer. */
export interface ListedResident<R> {
  resident: R
  city: string
}

/**
 * The residents of the full list (`CONTEXT.md`: Residents list), one after the other in the order
 * of the drawer's groups (`groupResidents`), each with their group's name as their city: hired,
 * alliance army and homeless residents have no city of the realm's to name.
 */
export function listedResidents<R>(groups: readonly ResidentGroup<R>[]): ListedResident<R>[] {
  return groups.flatMap((g) => g.residents.map((resident) => ({ resident, city: g.label })))
}

/** A resident's row in the full Residents list, as the table and the phone's card show it. */
export interface ResidentRow {
  id: string
  name: string
  leader: boolean
  /** In whole game years. */
  age: number
  city: string
  /** Each stat as it counts now, old age included (`statValue`), to one decimal. */
  stats: Record<StatName, number>
  /** "Mining 3.2, Combat 1", the best first; empty with none learned. */
  skills: string
  /** The weapon they fight with and the protection they carry: "Sword, Shield"; empty with none. */
  gear: string
  /** "4 Wood, 2 Food", the most first; empty with nothing. */
  carrying: string
  /** "12 / 30 kg" (`carryLine`). */
  weight: string
  /** How fed they are, 0 to 1. */
  fed: number
  /** How healthy they are, 0 to 1. */
  health: number
  doing: string
  /** The script they run or the order waiting behind a defence script, under Doing. */
  under?: string
}

const share = (value: number, max: number) => Math.max(0, Math.min(1, value / max))

/**
 * What the full Residents list shows of a resident (`CONTEXT.md`: Residents list). It is built only
 * for a resident whose hunger and health the Player knows (`CONTEXT.md`: Seeing how someone fares):
 * the list holds those they command, never someone merely in sight.
 */
export function residentRow(
  r: Resident,
  {
    city,
    leaderId,
    tick,
    doing,
    under,
  }: { city: string; leaderId: string; tick: number; doing: string; under?: string },
): ResidentRow {
  const stats = Object.fromEntries(
    STAT_NAMES.map((s) => [s, Math.round(statValue(r, s, tick) * 10) / 10]),
  ) as Record<StatName, number>
  const skills = (Object.keys(SKILL_LABELS) as SkillName[])
    .map((skill) => ({ skill, level: Math.floor((r.skills[skill] ?? 0) * 10) / 10 }))
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level)
  const weapon = bestWeapon(r)
  const worn = PROTECTION.filter((p) => (r.carried[p] ?? 0) > 0)
  return {
    id: r.id,
    name: r.name,
    leader: r.id === leaderId,
    age: Math.floor(ageInYears(r, tick)),
    city,
    stats,
    skills: skills.map((s) => `${SKILL_LABELS[s.skill]} ${s.level}`).join(', '),
    gear: [...(weapon ? [weapon] : []), ...worn].map((g) => GOOD_LABELS[g]).join(', '),
    carrying: goodsShort(r.carried, GOOD_LABELS, Infinity) ?? '',
    weight: carryLine(stockWeight(r.carried), carryCapacity(r, tick)),
    fed: share(r.hunger, MAX_HUNGER),
    health: share(r.health, MAX_HEALTH),
    doing,
    ...(under !== undefined && { under }),
  }
}

/** The rows to draw of a long list, and the space the rows above and below them would take. */
export interface RowWindow {
  /** The first row to draw. */
  first: number
  /** One past the last row to draw. */
  end: number
  /** Pixels of empty space above the first row. */
  before: number
  /** Pixels of empty space below the last row. */
  after: number
}

/**
 * Which rows of a list of equally tall rows to draw while it is scrolled to `scrollTop` in a view
 * `viewport` pixels tall, so hundreds of residents stay smooth: those in view and `overscan` more
 * at each edge. A list that got shorter while scrolled far down draws its last rows.
 */
export function rowWindow({
  count,
  rowHeight,
  scrollTop,
  viewport,
  overscan = ROW_OVERSCAN,
}: {
  count: number
  rowHeight: number
  scrollTop: number
  viewport: number
  overscan?: number
}): RowWindow {
  const inView = Math.ceil(viewport / rowHeight) + 1
  const top = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight), count - inView))
  const first = Math.max(0, top - overscan)
  const end = Math.min(count, top + inView + overscan)
  return { first, end, before: first * rowHeight, after: (count - end) * rowHeight }
}

/** Where to scroll a list of equally tall rows so that a row sits in the middle of the view. */
export function scrollToRow(index: number, rowHeight: number, viewport: number): number {
  return Math.max(0, index * rowHeight - (viewport - rowHeight) / 2)
}
