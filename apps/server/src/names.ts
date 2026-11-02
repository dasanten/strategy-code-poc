import type { WorldState } from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * Game-given names (`CONTEXT.md`: Game-given names): a name the game gives a resident is one no
 * living resident of that realm has, an NPC city counting as a realm; a name it gives a city is
 * one no city in the world has. When its list runs dry it adds a numeral ("Edda II") rather than
 * repeating one. Players' renames stay free and may make duplicates.
 */

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** `n` in Roman numerals, for the second, third, … of one name: 2 is "II". */
export function numeral(n: number): string {
  let out = ''
  for (const [value, letters] of ROMAN) {
    while (n >= value) {
      out += letters
      n -= value
    }
  }
  return out
}

/** A name without the numeral the game may have added to it: "Edda II" is "Edda". */
export function baseName(name: string): string {
  return name.replace(/ [IVXLCDM]+$/, '')
}

/**
 * A name `taken` doesn't hold, for the game to give: `drawn` if it is free, else the next free
 * name of `pool` after it (wrapping round), else `drawn` with the lowest numeral that is free
 * ("Edda II", "Edda III", …). Needs no randomness, so a seeded world names things alike.
 */
export function uniqueName(
  drawn: string,
  taken: ReadonlySet<string>,
  pool: readonly string[] = [],
): string {
  if (!taken.has(drawn)) return drawn
  const start = pool.indexOf(drawn)
  for (let i = 1; i <= pool.length; i++) {
    const name = pool[(start + i) % pool.length]!
    if (!taken.has(name)) return name
  }
  const base = baseName(drawn)
  for (let n = 2; ; n++) {
    const name = `${base} ${numeral(n)}`
    if (!taken.has(name)) return name
  }
}

/**
 * The names of the living residents of the realm a resident of `owner` living in `cityId` belongs
 * to: the Player's realm, or for one of no realm the NPC city they live in. One of no realm and no
 * city shares a realm with nobody.
 */
export function residentNamesTaken(
  world: Pick<WorldState, 'residents'>,
  owner: string | null,
  cityId: string | null,
): Set<string> {
  if (owner === null && cityId === null) return new Set()
  return new Set(
    world.residents.filter((r) => r.health > 0 && sameRealm(r, owner, cityId)).map((r) => r.name),
  )
}

/** Whether a resident belongs to the realm of `owner`, or for no realm to the NPC city `cityId`. */
function sameRealm(
  r: { owner: string | null; cityId: string | null },
  owner: string | null,
  cityId: string | null,
): boolean {
  return owner !== null ? r.owner === owner : r.owner === null && r.cityId === cityId
}

/** The names of every city in the world. */
export function cityNamesTaken(world: Pick<WorldState, 'cities'>): Set<string> {
  return new Set(world.cities.map((c) => c.name))
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Game-given names): no two living residents of one realm, an
 * NPC city counting as one, share a name the game gave them and nobody renamed (`gameName`).
 */
export const gameNamesUnique: Invariant = {
  name: 'game-names-unique',
  check(world) {
    const out: InvariantViolation[] = []
    const seen = new Map<string, string>()
    for (const r of world.residents) {
      if (!r.gameName || r.health <= 0) continue
      if (r.owner === null && r.cityId === null) continue
      const key = `${r.owner === null ? `city:${r.cityId}` : r.owner}|${r.name}`
      const other = seen.get(key)
      if (other === undefined) seen.set(key, r.id)
      else
        out.push({
          invariant: this.name,
          message: `residents ${other} and ${r.id} of one realm both have the game's name ${r.name}`,
          entityIds: [other, r.id],
        })
    }
    return out
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Game-given names): no two cities share a name the game gave
 * them and nobody renamed (`gameName`).
 */
export const cityGameNamesUnique: Invariant = {
  name: 'city-game-names-unique',
  check(world) {
    const out: InvariantViolation[] = []
    const seen = new Map<string, string>()
    for (const c of world.cities) {
      if (!c.gameName) continue
      const other = seen.get(c.name)
      if (other === undefined) seen.set(c.name, c.id)
      else
        out.push({
          invariant: this.name,
          message: `cities ${other} and ${c.id} both have the game's name ${c.name}`,
          entityIds: [other, c.id],
        })
    }
    return out
  },
}
