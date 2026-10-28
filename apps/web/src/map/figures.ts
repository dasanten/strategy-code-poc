import { PROTECTION, WEAPONS, isLineOrder, type Good, type Resident } from '@csp/shared'
import { isLeader, rankedAs, type Leaders, type Relationship, type Tone } from './tokens.js'

/**
 * What a resident is doing, as the small icon by their figure at close zoom (ADR 0008). A resident
 * standing about has none.
 */
export type Activity = 'fighting' | 'working' | 'carrying' | 'walking'

/** What a resident holds that is not a load: their food and the gear they fight with. */
const NOT_A_LOAD: ReadonlySet<Good> = new Set<Good>(['food', ...WEAPONS, ...PROTECTION])

/**
 * A resident's activity from their order and what they hold: attacking is fighting; working a
 * workplace, building, tearing down or laying a road is working; otherwise holding goods beyond
 * their food and gear is carrying, and being on the way somewhere is walking.
 */
export function residentActivity(
  r: Pick<Resident, 'order' | 'carried' | 'x' | 'y'>,
): Activity | undefined {
  const o = r.order
  if (o?.kind === 'attack') return 'fighting'
  if (
    o?.kind === 'workAt' ||
    o?.kind === 'build' ||
    o?.kind === 'tearDown' ||
    (isLineOrder(o) && o.phase === 'building')
  )
    return 'working'
  const load = Object.entries(r.carried).some(([g, n]) => n! > 0 && !NOT_A_LOAD.has(g as Good))
  if (load) return 'carrying'
  if (moving(r)) return 'walking'
  return undefined
}

/** On the way: walking, driving or climbing, and not yet there. */
function moving(r: Pick<Resident, 'order' | 'x' | 'y'>): boolean {
  const o = r.order
  switch (o?.kind) {
    case 'walkTo':
    case 'drive':
      return o.target.x !== r.x || o.target.y !== r.y
    case 'haul':
      return o.phase === 'driving'
    case 'roadLine':
    case 'wallLine':
    case 'store':
    case 'fetch':
      return o.phase === 'walking'
    case 'climb':
      return true
    default:
      return false
  }
}

/** The most single figures on one tile; beyond that the last place shows "+N" (ADR 0008). */
export const FIGURES_PER_TILE = 4

/**
 * Where the figures on a tile stand, as fractions of the tile from its top-left corner: the lower
 * corners first, then the upper ones. With more residents than places, the upper right place holds
 * the "+N" badge instead.
 */
const SLOTS: readonly (readonly [number, number])[] = [
  [0.22, 0.78],
  [0.78, 0.78],
  [0.22, 0.22],
  [0.78, 0.22],
]

/** One resident drawn as their own figure. */
export interface Figure {
  id: string
  /** Where on the tile, as fractions from its top-left corner. */
  dx: number
  dy: number
}

/** The figures on one tile, and the "+N" badge for the residents left out. */
export interface TileFigures {
  figures: Figure[]
  /** The residents not drawn and where their badge sits; missing when everyone is drawn. */
  more?: { ids: string[]; dx: number; dy: number }
}

/**
 * Lays out the residents on one tile as single figures (ADR 0008, close zoom): up to
 * `FIGURES_PER_TILE`; with more, one place fewer and a "+N" badge in the last. The viewer's Leader
 * (on the admin map every Leader) comes first, then residents by how close they stand to the
 * viewer (own, alliance, others), so the ones the Player cares about are the ones drawn. Otherwise
 * they keep their order.
 */
export function tileFigures(
  ids: readonly string[],
  relOf: (id: string) => Tone | undefined,
  leaders?: Leaders,
): TileFigures {
  const rank = (id: string) => (isLeader(leaders, id) ? -1 : RANK.indexOf(rankedAs(relOf(id))))
  const sorted = ids
    .map((id, i) => ({ id, i, rank: rank(id) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.id)
  const room = sorted.length > FIGURES_PER_TILE ? FIGURES_PER_TILE - 1 : FIGURES_PER_TILE
  const figures = sorted.slice(0, room).map((id, i) => {
    const [dx, dy] = SLOTS[i]!
    return { id, dx, dy }
  })
  if (sorted.length <= room) return { figures }
  const [dx, dy] = SLOTS[FIGURES_PER_TILE - 1]!
  return { figures, more: { ids: sorted.slice(room), dx, dy } }
}

/** Which residents are drawn first on a crowded tile. */
const RANK: (Relationship | undefined)[] = ['own', 'alliance', 'other', 'npc', 'trade', undefined]
