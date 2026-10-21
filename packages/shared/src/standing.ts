import { realmName } from './alliance.js'
import { FORMER_PLAYER_STANDING, STANDING_DRIFT_PER_DAY, STANDING_RANGE } from './balance.js'
import { TRADE_ORG, TRADE_ORG_NAME } from './trade-org.js'
import { TICKS_PER_GAME_DAY, type City, type WorldState } from './world.js'

/*
 * Standing (`CONTEXT.md`: Standing): how one Organization regards another, from
 * -`STANDING_RANGE` to +`STANDING_RANGE`, neutral at 0. Queries here are the game API that orders,
 * scripts and the game's own NPC behaviour share (ADR 0002).
 */

/**
 * The Organization an id names for standing: a realm, an NPC city, or the Trade Organization
 * (`TRADE_ORG`), whose cities are all one Organization.
 */
export function standingOrganization(world: Pick<WorldState, 'cities'>, org: string): string {
  return world.cities.some((c) => c.id === org && c.tradeOrg !== undefined) ? TRADE_ORG : org
}

/** How `of` regards `toward` (`CONTEXT.md`: Standing); 0 is neutral, also for an Organization itself. */
export function standingOf(
  world: Pick<WorldState, 'standings' | 'cities'>,
  of: string,
  toward: string,
): number {
  const a = standingOrganization(world, of)
  const b = standingOrganization(world, toward)
  return world.standings.find((s) => s.of === a && s.toward === b)?.value ?? 0
}

/** Whether a standing value is within its range. */
export const standingInRange = (value: number) =>
  Number.isFinite(value) && value >= -STANDING_RANGE && value <= STANDING_RANGE

/**
 * The standing a self-managed city holds its former Player in at `tick` (`CONTEXT.md`:
 * Self-managed city): `FORMER_PLAYER_STANDING` when their Leader died, fading like any standing
 * since; 0 once it has faded, or for a city that remembers no former Player.
 */
export function formerPlayerStanding(city: Pick<City, 'formerPlayer'>, tick: number): number {
  if (!city.formerPlayer) return 0
  const days = (tick - city.formerPlayer.tick) / TICKS_PER_GAME_DAY
  return Math.max(0, FORMER_PLAYER_STANDING - STANDING_DRIFT_PER_DAY * days)
}

/** How Players call an Organization: a realm by its Leader's name, a city by its own. */
export function organizationLabel(
  world: Pick<WorldState, 'realms' | 'residents' | 'cities'>,
  org: string,
): string {
  if (org === TRADE_ORG) return TRADE_ORG_NAME
  const city = world.cities.find((c) => c.id === org)
  return city ? city.name : realmName(world, org)
}

/**
 * One Organization as a Player sees standing with it: how it regards their realm (`theirs`) and
 * how their realm regards it (`yours`), both rounded to whole points.
 */
export interface StandingView {
  org: string
  name: string
  /** A realm, an NPC city, or the Trade Organization. */
  is: 'realm' | 'city' | 'tradeOrg'
  theirs: number
  yours: number
}

/**
 * The Organizations with a standing other than neutral toward the realm or from it, as its
 * Player sees them (`CONTEXT.md`: Standing: shown only), the worst regard of the realm first.
 */
export function standingsFor(
  world: Pick<WorldState, 'standings' | 'realms' | 'residents' | 'cities'>,
  realmId: string,
): StandingView[] {
  const others = new Set<string>()
  for (const s of world.standings) {
    if (s.toward === realmId) others.add(s.of)
    if (s.of === realmId) others.add(s.toward)
  }
  const views: StandingView[] = []
  for (const org of others) {
    const theirs = Math.round(standingOf(world, org, realmId))
    const yours = Math.round(standingOf(world, realmId, org))
    if (theirs === 0 && yours === 0) continue
    const is =
      org === TRADE_ORG ? 'tradeOrg' : world.cities.some((c) => c.id === org) ? 'city' : 'realm'
    views.push({ org, name: organizationLabel(world, org), is, theirs, yours })
  }
  return views.sort((a, b) => a.theirs - b.theirs || a.name.localeCompare(b.name))
}
