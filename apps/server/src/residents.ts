import {
  CHILD_STAT_SPREAD,
  MAX_HEALTH,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HUNGER,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STAT_NAMES,
  START_AGE_MAX,
  START_AGE_MIN,
  ticksForAge,
  type Resident,
  type Stat,
  type StatName,
} from '@csp/shared'
import { uniqueName } from './names.js'

/** Small seeded PRNG, so the same seed always makes the same residents. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Given names for new residents. Only flavour: a name means nothing to the rules. */
export const RESIDENT_NAMES: readonly string[] = [
  'Mara',
  'Tobin',
  'Corwin',
  'Edda',
  'Pell',
  'Ilse',
  'Saskia',
  'Bram',
  'Odo',
  'Wren',
  'Hale',
  'Ysolde',
  'Garrick',
  'Linnea',
  'Aldo',
  'Petra',
  'Rurik',
  'Senna',
  'Joran',
  'Tilde',
  'Anselm',
  'Brisa',
  'Cato',
  'Dagny',
  'Emeric',
  'Fenna',
  'Gisli',
  'Hesper',
  'Ivo',
  'Jutta',
]

/** A name from the game's list for a resident, drawn with `rand`. */
export function residentName(rand: () => number): string {
  return RESIDENT_NAMES[Math.floor(rand() * RESIDENT_NAMES.length)]!
}

/**
 * The name the game gives a new resident, drawn with `rand` (`CONTEXT.md`: Game-given names):
 * with `taken`, the names of their realm's living residents (`residentNamesTaken`), one it
 * doesn't hold, which it then holds too, marked as the game's. Without, the bare draw.
 */
function givenName(rand: () => number, taken?: Set<string>): Pick<Resident, 'name' | 'gameName'> {
  const drawn = residentName(rand)
  if (!taken) return { name: drawn }
  const name = uniqueName(drawn, taken, RESIDENT_NAMES)
  taken.add(name)
  return { name, gameName: true }
}

/** A lifespan in game years between `LIFESPAN_MIN` and `LIFESPAN_MAX` (`CONTEXT.md`: Aging). */
export function drawLifespan(rand: () => number): number {
  return LIFESPAN_MIN + rand() * (LIFESPAN_MAX - LIFESPAN_MIN)
}

const between = (rand: () => number, min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1))

/**
 * A new adult resident with random base stats, nothing trained or learned yet, full health and
 * a full hunger meter, aged between `START_AGE_MIN` and `START_AGE_MAX` at `tick`, with a
 * lifespan between `LIFESPAN_MIN` and `LIFESPAN_MAX`. Its name is one `taken` doesn't hold
 * (`givenName`).
 */
export function newResident(
  rand: () => number,
  fields: {
    id: string
    owner: string | null
    cityId?: string | null
    x: number
    y: number
    tick: number
  },
  taken?: Set<string>,
): Resident {
  const stats = Object.fromEntries(
    STAT_NAMES.map((s) => [s, { base: between(rand, STAT_BASE_MIN, STAT_BASE_MAX), trained: 0 }]),
  ) as Record<StatName, Stat>
  const age = START_AGE_MIN + rand() * (START_AGE_MAX - START_AGE_MIN)
  const { tick, cityId = null, ...place } = fields
  const name = givenName(rand, taken)
  return {
    ...place,
    cityId,
    ...name,
    stats,
    skills: {},
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    bornAt: tick - Math.round(ticksForAge(age)),
    lifespan: drawLifespan(rand),
    carried: {},
    order: null,
  }
}

/** A resident's base stats (`CONTEXT.md`: Base value), the only part a child inherits. */
export function baseStats(r: Resident): Record<StatName, number> {
  return Object.fromEntries(STAT_NAMES.map((s) => [s, r.stats[s].base])) as Record<StatName, number>
}

/**
 * A child of two parents, given by their base stats, born at `tick` (`CONTEXT.md`: Child): each base stat is the parents'
 * average, rounded, plus a whole random amount of at most `CHILD_STAT_SPREAD` either way, and at
 * least 1. Nothing trained or learned, since neither is inherited; full health and hunger meter;
 * a lifespan between `LIFESPAN_MIN` and `LIFESPAN_MAX`; a name `taken` doesn't hold (`givenName`).
 */
export function newChild(
  rand: () => number,
  parents: [Record<StatName, number>, Record<StatName, number>],
  fields: {
    id: string
    owner: string | null
    cityId: string | null
    x: number
    y: number
    tick: number
  },
  taken?: Set<string>,
): Resident {
  const [a, b] = parents
  const stats = Object.fromEntries(
    STAT_NAMES.map((s) => {
      const average = Math.round((a[s] + b[s]) / 2)
      const base = average + between(rand, -CHILD_STAT_SPREAD, CHILD_STAT_SPREAD)
      return [s, { base: Math.max(1, base), trained: 0 }]
    }),
  ) as Record<StatName, Stat>
  const { tick, ...place } = fields
  return {
    ...place,
    ...givenName(rand, taken),
    stats,
    skills: {},
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    bornAt: tick,
    lifespan: drawLifespan(rand),
    carried: {},
    order: null,
  }
}

/** A string's FNV-1a hash, as a seed. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
