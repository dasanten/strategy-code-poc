import {
  STANDING_DRIFT_PER_DAY,
  STANDING_RANGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  formerPlayerStanding,
  standingInRange,
  standingOrganization,
  type City,
  type Realm,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * Standing (`CONTEXT.md`: Standing): how one Organization regards another. Known crimes lower the
 * victim's standing toward the culprit's Organization (`stepCrimes`); trades at a Trade Org
 * warehouse (`resolveTrades`) and paid contract weeks (`payInto`) raise it both ways; a contract
 * broken by an unpaid week lowers the lender's toward the hirer (`stepContracts`). Every day it
 * drifts back toward neutral. For Players it is shown only; the game acts on it for NPC cities
 * and the Trade Organization.
 */

/**
 * Changes how `of` regards `toward` by `delta`, kept within its range. Nothing happens between an
 * Organization and itself. A standing back at neutral is dropped.
 */
export function changeStanding(world: WorldState, of: string, toward: string, delta: number): void {
  const a = standingOrganization(world, of)
  const b = standingOrganization(world, toward)
  if (a === b || delta === 0) return
  const s = world.standings.find((x) => x.of === a && x.toward === b)
  const value = Math.max(-STANDING_RANGE, Math.min(STANDING_RANGE, (s?.value ?? 0) + delta))
  if (s) s.value = value
  else world.standings.push({ of: a, toward: b, value })
  if (value === 0) world.standings = world.standings.filter((x) => x.value !== 0)
}

/** Raises standing by `delta` both ways between two Organizations. */
export function raiseStandingBothWays(
  world: WorldState,
  a: string,
  b: string,
  delta: number,
): void {
  changeStanding(world, a, b, delta)
  changeStanding(world, b, a, delta)
}

/**
 * Whether an Organization still exists: a realm, a city of no realm, or the Trade Organization
 * while it has a city. A city that joined a realm is part of that realm's Organization now.
 */
function organizationExists(world: WorldState, org: string): boolean {
  if (org === TRADE_ORG) return world.cities.some((c) => c.tradeOrg !== undefined)
  return (
    world.realms.some((r) => r.id === org) ||
    world.cities.some((c) => c.id === org && c.realmId === null)
  )
}

/**
 * Standing drifts back toward neutral by `STANDING_DRIFT_PER_DAY` each game day, a little each
 * tick, and is dropped once neutral. Standing of or toward an Organization that is gone (a realm
 * whose Leader died, a city torn down) is dropped too.
 */
export function stepStanding(world: WorldState): void {
  forgetFormerPlayers(world)
  if (world.standings.length === 0) return
  const drift = STANDING_DRIFT_PER_DAY / TICKS_PER_GAME_DAY
  world.standings = world.standings.filter((s) => {
    if (!organizationExists(world, s.of) || !organizationExists(world, s.toward)) return false
    s.value = s.value > 0 ? Math.max(0, s.value - drift) : Math.min(0, s.value + drift)
    return s.value !== 0
  })
}

/**
 * Standing holds together (`CONTEXT.md`: Standing): every value within its range and not
 * neutral, between two different Organizations that exist, the Trade Organization named as one,
 * and at most one standing for each pair.
 */
export const standingsSound: Invariant = {
  name: 'standings-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const seen = new Set<string>()
    for (const s of world.standings ?? []) {
      const ids = [s.of, s.toward]
      const report = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: ids })
      const pair = `${s.of} → ${s.toward}`
      if (!standingInRange(s.value)) report(`standing ${pair} is ${s.value}, out of its range`)
      if (s.value === 0) report(`standing ${pair} is neutral but kept`)
      if (s.of === s.toward) report(`${s.of} has a standing toward itself`)
      for (const org of ids) {
        if (!organizationExists(world, org)) report(`standing ${pair} names ${org}, which is gone`)
        if (standingOrganization(world, org) !== org) {
          report(`standing ${pair} names a Trade Org city instead of the Trade Organization`)
        }
      }
      if (seen.has(pair)) report(`standing ${pair} is kept twice`)
      seen.add(pair)
    }
    return out
  },
}

/*
 * A self-managed city remembers its former Player (`CONTEXT.md`: Self-managed city): it starts out
 * holding them in good standing, which fades like any standing. Their realm is gone until they
 * come back, so the city keeps the memory (`City.formerPlayer`) and gives the standing, as far as
 * it has faded by then, to their next realm when it is founded.
 */

/** The cities of a realm whose Leader just died remember its Player from now on. */
export function rememberFormerPlayer(world: WorldState, cities: City[], userId: number): void {
  for (const c of cities) c.formerPlayer = { userId, tick: world.tick }
}

/**
 * A Player's new realm is founded: every self-managed city that remembers them holds the realm
 * in the good standing left of its memory, and the memory now lives on as that standing.
 */
export function welcomeFormerPlayer(world: WorldState, realm: Realm): void {
  for (const c of world.cities) {
    if (c.formerPlayer?.userId !== realm.userId) continue
    if (c.realmId === null)
      changeStanding(world, c.id, realm.id, formerPlayerStanding(c, world.tick))
    delete c.formerPlayer
  }
}

/** A city forgets its former Player once the memory has faded, or once it joined a realm. */
export function forgetFormerPlayers(world: WorldState): void {
  for (const c of world.cities) {
    if (!c.formerPlayer) continue
    if (c.realmId !== null || formerPlayerStanding(c, world.tick) === 0) delete c.formerPlayer
  }
}

/**
 * Former Players are remembered soundly (`CONTEXT.md`: Self-managed city): only by cities of no
 * realm and not of the Trade Organization, from a tick already passed, and only
 * while the Player has no realm (a new one takes the memory over as standing).
 */
export const formerPlayersSound: Invariant = {
  name: 'former-players-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const c of world.cities) {
      const f = c.formerPlayer
      if (!f) continue
      const report = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: [c.id] })
      if (c.realmId !== null) report(`${c.id} belongs to a realm but remembers a former Player`)
      if (c.tradeOrg !== undefined) report(`Trade Org city ${c.id} remembers a former Player`)
      if (f.tick > world.tick) report(`${c.id} remembers a Leader death still to come`)
      if (world.realms.some((r) => r.userId === f.userId)) {
        report(`${c.id} remembers Player ${f.userId}, who has a realm again`)
      }
    }
    return out
  },
}
