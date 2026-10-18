import {
  MAX_HEALTH,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HUNGER,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STAT_NAMES,
  START_AGE_MAX,
  START_AGE_MIN,
  TICKS_PER_GAME_YEAR,
  type Resident,
  type Stat,
  type StatName,
} from '@csp/shared'

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
const NAMES = [
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

/** A lifespan in game years between `LIFESPAN_MIN` and `LIFESPAN_MAX` (`CONTEXT.md`: Aging). */
export function drawLifespan(rand: () => number): number {
  return LIFESPAN_MIN + rand() * (LIFESPAN_MAX - LIFESPAN_MIN)
}

const between = (rand: () => number, min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1))

/**
 * A new adult resident with random base stats, nothing trained or learned yet, full health and
 * a full hunger meter, aged between `START_AGE_MIN` and `START_AGE_MAX` at `tick`, with a
 * lifespan between `LIFESPAN_MIN` and `LIFESPAN_MAX`.
 */
export function newResident(
  rand: () => number,
  fields: { id: string; owner: string; x: number; y: number; tick: number },
): Resident {
  const stats = Object.fromEntries(
    STAT_NAMES.map((s) => [s, { base: between(rand, STAT_BASE_MIN, STAT_BASE_MAX), trained: 0 }]),
  ) as Record<StatName, Stat>
  const age = START_AGE_MIN + rand() * (START_AGE_MAX - START_AGE_MIN)
  const { tick, ...place } = fields
  const name = NAMES[Math.floor(rand() * NAMES.length)]!
  return {
    ...place,
    name,
    stats,
    skills: {},
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    bornAt: tick - Math.round(age * TICKS_PER_GAME_YEAR),
    lifespan: drawLifespan(rand),
    carried: {},
    order: null,
  }
}
